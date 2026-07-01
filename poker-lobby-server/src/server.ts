import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { 
  PokerTable, 
  LobbyState, 
  createDeck, 
  getCurrentBlinds, 
  isBotPlayer, 
  getBasicAiDecision,
  AUTOPLAY_MAX_TURNS,
  dealNewHand as sharedDealNewHand,
  advanceGame as sharedAdvanceGame
} from '@zao-poker/core';

dotenv.config();

const app = express();
app.use(express.json());

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_CONNECTION_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';

if (!TURSO_URL) {
  console.warn('No TURSO_DATABASE_URL set. Lobby will run without DB persistence.');
}

const db = TURSO_URL ? createClient({ url: TURSO_URL, authToken: TURSO_TOKEN }) : null;

const PORT = process.env.PORT || 3001;

// In-memory lobby for quick broadcast (backed by DB for persistence)
let lobbyState: LobbyState = { tables: [], updatedAt: Date.now() };

async function loadLobbyFromDb(): Promise<LobbyState> {
  if (!db) return { tables: [], updatedAt: Date.now() };

  try {
    const { rows: tableRows } = await db.execute('SELECT * FROM tables ORDER BY created_at DESC LIMIT 50');
    const tables: PokerTable[] = [];

    for (const t of tableRows) {
      const { rows: playerRows } = await db.execute({
        sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index ASC',
        args: [t.id]
      });

      const seats = Array.from({ length: Number(t.max_players || 6) }, (_, i) => ({
        seatNumber: i + 1,
        user: null,
        stack: 5000,
        currentBet: 0,
        isReady: false,
        isBot: false,
        holeCards: [],
      } as any));

      for (const p of playerRows) {
        const idx = Number(p.seat_index || 0);
        if (idx >= 0 && idx < seats.length) {
          seats[idx] = {
            seatNumber: idx + 1,
            user: {
              id: `fid:${p.fid}`,
              fid: Number(p.fid),
              username: p.username || `User#${p.fid}`,
              avatarUrl: p.pfp_url,
            },
            stack: Number(p.stack_size || 5000),
            currentBet: Number(p.current_bet || 0),
            isReady: Number(p.is_ready || 0) === 1,
            isBot: Number(p.is_bot || 0) === 1,
            holeCards: String(p.hand || '').split(',').filter(Boolean),
            status: p.status,
            hasActed: Number(p.has_acted || 0) === 1,
          };
        }
      }

      tables.push({
        id: String(t.id),
        name: String(t.name || 'Table'),
        game: (t.game_type as any) || 'NLHE',
        stakes: String(t.stakes_label || '$0.10 / $0.25'),
        maxPlayers: Number(t.max_players || 6),
        buyIn: Number(t.buy_in || 25),
        visibility: (t.visibility as any) || 'public',
        clubId: t.club_id ? String(t.club_id) : null,
        clubName: t.club_name ? String(t.club_name) : null,
        status: (t.status === 'playing' ? 'in_game' : (t.status || 'waiting')) as any,
        createdAt: t.created_at ? new Date(t.created_at).getTime() : Date.now(),
        startTime: t.start_time,
        board: String(t.board || '').split(',').filter(Boolean),
        potSize: Number(t.pot_size || 0),
        currentBet: Number(t.current_bet || 0),
        phase: String(t.phase || 'preflop'),
        actionHistory: String(t.action_history || '').split('|').filter(Boolean),
        currentTurnFid: t.current_turn_fid ? Number(t.current_turn_fid) : null,
        seats,
      });
    }

    return { tables, updatedAt: Date.now() };
  } catch (e) {
    console.error('Failed to load lobby from DB', e);
    return { tables: [], updatedAt: Date.now() };
  }
}

async function broadcastState() {
  lobbyState = await loadLobbyFromDb();
  const payload = JSON.stringify({ type: 'state', payload: lobbyState });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Health check for Render
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Lobby state (for polling / checks)
app.get('/lobby', async (_req, res) => {
  const state = await loadLobbyFromDb();
  res.json(state);
});

// Basic action endpoint (for POSTs from frontend when using Render)
// For first pass, duplicated some logic to call full shared functions
app.post('/api/table', async (req, res) => {
  const { fid, table_id: tableId, action, amount = 0 } = req.body || {};
  console.log('[lobby] /api/table action received', action, 'for', tableId);

  if (!db) {
    await broadcastState();
    return res.json({ success: false, error: 'No DB' });
  }

  try {
    const sharedDb = {
      execute: (opt: any) => db.execute(typeof opt === 'string' ? { sql: opt } : opt)
    } as any;

    if (action === 'deal') {
      const { rows: players } = await db.execute({
        sql: "SELECT fid FROM players WHERE table_id = ? ORDER BY seat_index ASC",
        args: [tableId]
      });
      const fids = players.map((p: any) => Number(p.fid));
      await sharedDealNewHand(sharedDb, tableId, fids);
    } else if (action === 'table_action') {
      // Simplified: for demo, just update some state and advance if needed
      // In real, port full action handler from mini-app
      await db.execute({
        sql: "UPDATE players SET has_acted = 1 WHERE fid = ? AND table_id = ?",
        args: [fid, tableId]
      });
      // Check if street over and advance (dupe check for pass)
      const { rows: stateRows } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [tableId] });
      const current = stateRows[0];
      if (current) {
        const { rows: rem } = await db.execute({
          sql: "SELECT has_acted, current_bet FROM players WHERE table_id = ? AND status = 'playing'",
          args: [tableId]
        });
        const streetOver = rem.every((p: any) => Number(p.has_acted || 0) === 1 && Number(p.current_bet || 0) === Number(current.current_bet || 0));
        if (streetOver) {
          await sharedAdvanceGame(sharedDb, tableId, current);
        }
      }
    }

    await broadcastState();
    res.json({ success: true });
  } catch (e: any) {
    console.error(e);
    res.json({ success: false, error: e.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Poker Lobby Server listening on port ${PORT}`);
});

// WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws) => {
  console.log('WS client connected');

  // Send current state on connect
  const state = await loadLobbyFromDb();
  ws.send(JSON.stringify({ type: 'state', payload: state }));

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('WS message:', msg.type);

      switch (msg.type) {
        case 'get_state':
          const s = await loadLobbyFromDb();
          ws.send(JSON.stringify({ type: 'state', payload: s }));
          break;

        case 'join_table':
        case 'leave_table':
        case 'toggle_ready':
        case 'table_action':
        case 'deal_hand':
        case 'create_table':
          console.log(`[lobby] Handling ${msg.type} for table ${msg.payload?.tableId}`);
          await broadcastState();
          if (msg.payload?.tableId) {
            await runAutoplayUntilHuman(msg.payload.tableId);
            await broadcastState();
          }
          break;

        default:
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Unknown message type' } }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid message' } }));
    }
  });

  ws.on('close', () => {
    console.log('WS client disconnected');
  });
});

// Periodic broadcast for live updates (when no WS push)
setInterval(async () => {
  await broadcastState();
}, 5000);

// Initial load
loadLobbyFromDb().then(s => { lobbyState = s; });

console.log('Lobby server ready. Configure NEXT_PUBLIC_RENDER_* in Vercel to point here.');

// Full bot autoplay logic (ported for server)
async function playAutomatedTurn(tableId: string) {
  if (!db) return false;
  const { rows: stateRows } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [tableId] });
  const currentGameState = stateRows[0];
  if (!currentGameState || currentGameState.status !== "playing" || !currentGameState.current_turn_fid) {
    return false;
  }

  const { rows: remainingActive } = await db.execute({
    sql: `SELECT fid, current_bet, has_acted, hand, stack_size, is_bot FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC`,
    args: [tableId]
  });

  const aiPlayer = remainingActive.find((player: any) => Number(player.fid) === Number(currentGameState.current_turn_fid) && isBotPlayer(player));
  if (!aiPlayer) return false;

  const newTableBet = Number(currentGameState.current_bet || 0);
  const newPotSize = Number(currentGameState.pot_size || 0);
  const aiCurrentBet = Number(aiPlayer.current_bet || 0);
  const aiToCall = newTableBet - aiCurrentBet;
  const aiFid = Number(aiPlayer.fid);

  const decision = getBasicAiDecision(aiToCall, newPotSize, Number(aiPlayer.stack_size || 0), currentGameState.phase);

  await db.execute({ sql: "UPDATE players SET has_acted = 1 WHERE fid = ? AND table_id = ?", args: [aiFid, tableId] });

  if (decision.action === "raise" || decision.action === "bet") {
    const aiTargetBet = Math.max(newTableBet, Math.min(Number(aiPlayer.stack_size || 0) + aiCurrentBet, decision.targetBet || newTableBet));
    const aiBetDiff = Math.max(0, aiTargetBet - aiCurrentBet);
    if (aiBetDiff > 0) {
      await db.execute({ sql: "UPDATE tables SET pot_size = pot_size + ?, current_bet = ? WHERE id = ?", args: [aiBetDiff, aiTargetBet, tableId] });
      await db.execute({ sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = total_invested + ? WHERE fid = ? AND table_id = ?", args: [aiBetDiff, aiTargetBet, aiBetDiff, aiFid, tableId] });
      await db.execute({ sql: "UPDATE players SET has_acted = 0 WHERE table_id = ? AND status = 'playing' AND is_bot = 0", args: [tableId] });
      await db.execute({ sql: "UPDATE players SET has_acted = 1 WHERE fid = ? AND table_id = ?", args: [aiFid, tableId] });
      // append history stub
    }
    return true;
  }

  if (decision.action === "call" || decision.action === "check") {
    const callAmount = Math.max(0, aiToCall);
    await db.execute({ sql: "UPDATE tables SET pot_size = pot_size + ? WHERE id = ?", args: [callAmount, tableId] });
    await db.execute({ sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = total_invested + ? WHERE fid = ? AND table_id = ?", args: [callAmount, newTableBet, callAmount, aiFid, tableId] });
    const { rows: activeAfter } = await db.execute({ sql: "SELECT has_acted, current_bet FROM players WHERE table_id = ? AND status = 'playing'", args: [tableId] });
    const streetOver = activeAfter.every((p: any) => Number(p.has_acted || 0) === 1 && Number(p.current_bet || 0) === newTableBet);
    if (streetOver) {
      const { rows: fresh } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [tableId] });
      await sharedAdvanceGame({ execute: (o: any) => db.execute(typeof o === 'string' ? {sql:o} : o) } as any, tableId, fresh[0]);
    }
    return true;
  }

  await db.execute({ sql: "UPDATE players SET status = 'folded' WHERE fid = ? AND table_id = ?", args: [aiFid, tableId] });
  return true;
}

async function runAutoplayUntilHuman(tableId: string, maxTurns = AUTOPLAY_MAX_TURNS) {
  for (let i = 0; i < maxTurns; i++) {
    const acted = await playAutomatedTurn(tableId);
    if (!acted) break;
  }
}

// Enhance handlers with full autoplay
// (in message handlers, after state change: await runAutoplayUntilHuman(tableId))

