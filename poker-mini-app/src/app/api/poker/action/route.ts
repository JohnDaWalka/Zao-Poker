import { NextRequest, NextResponse } from 'next/server';
import { getValidActions, BET_ABSTRACTION } from '~/lib/poker/abstraction';
import { buildInfoSet, hashInfoSet, verifyInfoSet } from '~/lib/poker/state';
import { encodeActionHistory } from '~/lib/poker/encoding';
import { db } from '~/lib/db';
import { startNewHand, advanceStreet, isBettingRoundComplete, getNextTurnSeat, applyAction } from '~/lib/game-engine';
import { rateLimit, getClientIP } from '~/lib/rate-limit';
import { validateActionPayload } from '~/lib/validation';

const SERVER_SECRET = process.env.ZAO_SECRET || process.env.VERCEL_URL || 'zao-poker-dev-secret';

interface GameStateRow {
  id: string;
  pot_size: number;
  current_bet: number;
  board: string;
  phase: string;
  action_history: string;
  last_aggressor_fid: number | null;
  current_turn_fid: number | null;
  dealer_seat_index: number;
}

interface PlayerRow {
  fid: number;
  seat_index: number;
  stack_size: number;
  current_bet: number;
  hand: string;
  status: string;
  has_acted: number;
}

async function getGameState(gameId: string): Promise<{
  table: GameStateRow;
  players: PlayerRow[];
} | null> {
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT * FROM tables WHERE id = ?',
    args: [gameId],
  });
  if (tableRows.length === 0) return null;
  const table = tableRows[0] as unknown as GameStateRow;

  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index',
    args: [gameId],
  });
  const players = playerRows as unknown as PlayerRow[];

  return { table, players };
}

function parseBoard(boardStr: string): string[] {
  if (!boardStr || boardStr.trim() === '') return [];
  return boardStr.split(',').map((c) => c.trim()).filter(Boolean);
}

function parseHand(handStr: string): [string, string] | null {
  if (!handStr || handStr.trim() === '') return null;
  const cards = handStr.split(',').map((c) => c.trim()).filter(Boolean);
  if (cards.length < 2) return null;
  return [cards[0], cards[1]] as [string, string];
}

function buildStacks(players: PlayerRow[]): Record<number, number> {
  const stacks: Record<number, number> = {};
  for (const p of players) {
    if (p.seat_index !== null && p.seat_index !== undefined) {
      stacks[p.seat_index] = p.stack_size;
    }
  }
  return stacks;
}

function findPlayerBySeat(players: PlayerRow[], seat: number): PlayerRow | undefined {
  return players.find((p) => p.seat_index === seat);
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 30 actions per minute per IP
    const clientIP = getClientIP(req);
    const limit = rateLimit(`action:${clientIP}`, 30, 60000);
    if (!limit.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: Math.ceil((limit.resetAt - Date.now()) / 1000) },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
      );
    }

    const body = await req.json();
    
    // Validate input
    const validation = validateActionPayload(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    
    const { gameId, playerSeat, selectedAction, selectedAmount, stateHash } = validation.sanitized!;

    // 1. Rehydrate state from DB
    const gameState = await getGameState(gameId);
    if (!gameState) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    let { table, players } = gameState;
    const activePlayer = findPlayerBySeat(players, playerSeat);
    if (!activePlayer) {
      return NextResponse.json({ error: 'Player not found at seat' }, { status: 404 });
    }

    const holeCards = parseHand(activePlayer.hand);
    if (!holeCards) {
      return NextResponse.json({ error: 'No hole cards dealt' }, { status: 400 });
    }

    const communityCards = parseBoard(table.board);

    // 2. Build info set and verify integrity
    const stacks = buildStacks(players);
    const publicState = {
      pot: table.pot_size,
      communityCards,
      activeSeat: playerSeat,
      street: table.phase as 'preflop' | 'flop' | 'turn' | 'river',
      actionHistory: table.action_history,
      lastAggressor: table.last_aggressor_fid,
      currentBet: table.current_bet,
      stacks,
    };

    const infoSet = buildInfoSet(publicState, playerSeat, holeCards);

    if (stateHash && !verifyInfoSet(infoSet, stateHash, SERVER_SECRET)) {
      return NextResponse.json({ error: 'Invalid state hash' }, { status: 403 });
    }

    // 3. Apply action if provided
    let actionResult = { advanced: false, nextSeat: null as number | null };
    if (selectedAction !== undefined && selectedAction !== null) {
      const amount = selectedAmount ?? 0;
      actionResult = await applyAction(gameId, playerSeat, selectedAction, amount);
      // Re-fetch after mutation
      const refreshed = await getGameState(gameId);
      if (!refreshed) {
        return NextResponse.json({ error: 'Game state lost after action' }, { status: 500 });
      }
      // Update local state for response
      const refreshedPlayer = findPlayerBySeat(refreshed.players, playerSeat);
      if (refreshedPlayer) {
        activePlayer.stack_size = refreshedPlayer.stack_size;
        activePlayer.current_bet = refreshedPlayer.current_bet;
      }
      table.pot_size = refreshed.table.pot_size;
      table.current_bet = refreshed.table.current_bet;
      table.action_history = refreshed.table.action_history;
      table.phase = refreshed.table.phase;
      players = refreshed.players; // Update players list
    }

    // 4. Determine whose turn it is next
    let nextSeat: number;
    if (actionResult.advanced) {
      // Street advanced — find first to act on new street
      const activePlayers = players.filter((p) => p.status !== 'folded' && p.status !== 'waiting');
      nextSeat = activePlayers[0]?.seat_index ?? playerSeat;
    } else if (actionResult.nextSeat !== null) {
      nextSeat = actionResult.nextSeat;
    } else {
      // Fallback: simple clockwise rotation
      const activeSeats = players.filter((p) => p.status !== 'folded' && p.status !== 'waiting');
      const currentIdx = activeSeats.findIndex((p) => p.seat_index === playerSeat);
      const nextIdx = (currentIdx + 1) % activeSeats.length;
      nextSeat = activeSeats[nextIdx]?.seat_index ?? playerSeat;
    }

    // 5. Get valid actions for the next active player
    const nextPlayerData = findPlayerBySeat(players, nextSeat);
    const edges = getValidActions(
      table.current_bet,
      nextPlayerData?.stack_size ?? 0,
      table.pot_size,
      table.phase as 'preflop' | 'flop' | 'turn' | 'river',
      nextPlayerData?.has_acted === 1
    );

    // 6. Build new info set for the active player
    const nextInfoSet = buildInfoSet(
      {
        ...publicState,
        activeSeat: nextSeat,
        currentBet: table.current_bet,
        pot: table.pot_size,
        stacks: buildStacks(players),
      },
      nextSeat,
      parseHand(nextPlayerData?.hand ?? '') ?? ['?', '?']
    );
    const nextHash = hashInfoSet(nextInfoSet, SERVER_SECRET);

    // 7. Return Farcaster-optimized payload
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
    return NextResponse.json({
      hash: nextHash,
      pot: table.pot_size,
      street: table.phase,
      community: communityCards,
      facing: table.current_bet,
      myStack: nextPlayerData?.stack_size ?? 0,
      myCards: nextSeat === playerSeat ? holeCards : null,
      actions: edges.map((e) => ({
        t: e.type,
        l: e.label,
        amt: e.minAmount,
        term: e.isTerminal,
      })),
      history: encodeActionHistory(
        players.map((p) => ({
          seat: p.seat_index,
          action: p.has_acted,
          amount: p.current_bet,
          street: table.phase,
        })),
        table.phase
      ),
      // Farcaster Frame metadata
      frame: {
        version: 'vNext',
        image: `${baseUrl}/api/poker/frame?h=${nextHash}`,
        buttons: edges.map((e) => ({ label: e.label, action: 'post' })),
        post_url: `${baseUrl}/api/poker/action`,
      },
    });
  } catch (error) {
    console.error('Poker action API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
