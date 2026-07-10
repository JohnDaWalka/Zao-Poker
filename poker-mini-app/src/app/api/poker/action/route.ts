import { NextRequest, NextResponse } from 'next/server';
import { getValidActions, BET_ABSTRACTION } from '~/lib/poker/abstraction';
import { buildInfoSet, hashInfoSet, verifyInfoSet } from '~/lib/poker/state';
import { encodeActionHistory } from '~/lib/poker/encoding';
import { db } from '~/lib/db';

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

async function applyAction(
  tableId: string,
  players: PlayerRow[],
  seatIndex: number,
  actionType: number,
  amount: number
): Promise<void> {
  const player = findPlayerBySeat(players, seatIndex);
  if (!player) return;

  const table = (await getGameState(tableId))?.table;
  if (!table) return;

  const { current_bet, pot_size } = table;
  const playerCurrentBet = player.current_bet;
  const toCall = current_bet - playerCurrentBet;

  if (actionType === BET_ABSTRACTION.FOLD) {
    await db.execute({
      sql: 'UPDATE players SET status = ? WHERE table_id = ? AND seat_index = ?',
      args: ['folded', tableId, seatIndex],
    });
  } else if (actionType === BET_ABSTRACTION.CHECK_CALL) {
    const callAmount = Math.min(toCall, player.stack_size);
    if (callAmount > 0) {
      await db.execute({
        sql: 'UPDATE players SET stack_size = stack_size - ?, current_bet = current_bet + ?, total_invested = total_invested + ? WHERE table_id = ? AND seat_index = ?',
        args: [callAmount, callAmount, callAmount, tableId, seatIndex],
      });
      await db.execute({
        sql: 'UPDATE tables SET pot_size = pot_size + ? WHERE id = ?',
        args: [callAmount, tableId],
      });
    }
  } else if (actionType === BET_ABSTRACTION.BET_HALF || actionType === BET_ABSTRACTION.BET_FULL || actionType === BET_ABSTRACTION.ALL_IN) {
    const raiseTo = amount;
    const additional = raiseTo - playerCurrentBet;
    const actualAdditional = Math.min(additional, player.stack_size);
    if (actualAdditional > 0) {
      await db.execute({
        sql: 'UPDATE players SET stack_size = stack_size - ?, current_bet = current_bet + ?, total_invested = total_invested + ? WHERE table_id = ? AND seat_index = ?',
        args: [actualAdditional, actualAdditional, actualAdditional, tableId, seatIndex],
      });
      await db.execute({
        sql: 'UPDATE tables SET pot_size = pot_size + ?, current_bet = ? WHERE id = ?',
        args: [actualAdditional, playerCurrentBet + actualAdditional, tableId],
      });
    }
  }

  // Mark player as acted and advance turn
  await db.execute({
    sql: 'UPDATE players SET has_acted = 1 WHERE table_id = ? AND seat_index = ?',
    args: [tableId, seatIndex],
  });

  // Append action to history
  const actionChar = ['f', 'c', 'h', 'p', 'a'][actionType] ?? '?';
  const newHistory = table.action_history + `${seatIndex + 1}${actionChar}`;
  await db.execute({
    sql: 'UPDATE tables SET action_history = ? WHERE id = ?',
    args: [newHistory, tableId],
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { gameId, stateHash, playerSeat, selectedAction, selectedAmount } = body;

    if (!gameId || typeof playerSeat !== 'number') {
      return NextResponse.json({ error: 'gameId and playerSeat required' }, { status: 400 });
    }

    // 1. Rehydrate state from DB
    const gameState = await getGameState(gameId);
    if (!gameState) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const { table, players } = gameState;
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
    if (selectedAction !== undefined && selectedAction !== null) {
      const amount = selectedAmount ?? 0;
      await applyAction(gameId, players, playerSeat, selectedAction, amount);
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
    }

    // 4. Determine whose turn it is next (simple clockwise rotation)
    const activeSeats = players.filter((p) => p.status !== 'folded' && p.status !== 'waiting');
    const currentIdx = activeSeats.findIndex((p) => p.seat_index === playerSeat);
    const nextIdx = (currentIdx + 1) % activeSeats.length;
    const nextPlayer = activeSeats[nextIdx];
    const nextSeat = nextPlayer?.seat_index ?? playerSeat;

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
