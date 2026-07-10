/**
 * ZAO Poker Game Engine — Hand lifecycle management.
 * 
 * Handles: dealing, betting rounds, street advancement, showdown,
 * side pots, and hand history recording.
 */

import { db } from './db';
import { rankShowdownWinners, getBestOmaha8Hand, rankHighLowShowdown } from './poker-hand-evaluator';
import { getNextStreet, getGameConfig, usesBlinds, usesBoard } from './game-rules';

const FULL_DECK = [
  'As','Ks','Qs','Js','Ts','9s','8s','7s','6s','5s','4s','3s','2s',
  'Ah','Kh','Qh','Jh','Th','9h','8h','7h','6h','5h','4h','3h','2h',
  'Ad','Kd','Qd','Jd','Td','9d','8d','7d','6d','5d','4d','3d','2d',
  'Ac','Kc','Qc','Jc','Tc','9c','8c','7c','6c','5c','4c','3c','2c',
];

function shuffleDeck(seed: number): string[] {
  const deck = [...FULL_DECK];
  // Simple seeded shuffle (Fisher-Yates with LCG)
  let s = seed;
  for (let i = deck.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function generateSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

interface Player {
  fid: number;
  seat_index: number;
  stack_size: number;
  hand: string;
  status: string;
  has_acted: number;
  current_bet: number;
  total_invested: number;
  visible_cards: string;
}

interface Table {
  id: string;
  game_type: string;
  pot_size: number;
  current_bet: number;
  board: string;
  deck: string;
  phase: string;
  action_history: string;
  dealer_seat_index: number;
  last_aggressor_fid: number | null;
  current_turn_fid: number | null;
  max_players: number;
  status: string;
}

/**
 * Start a new hand: shuffle, deal, post blinds, set first to act.
 */
export async function startNewHand(tableId: string): Promise<void> {
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT * FROM tables WHERE id = ?',
    args: [tableId],
  });
  if (tableRows.length === 0) return;
  const table = tableRows[0] as unknown as Table;

  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index',
    args: [tableId],
  });
  const players = playerRows as unknown as Player[];

  // Reset hand state
  const seed = generateSeed();
  const deck = shuffleDeck(seed);

  // Reset players for new hand
  for (const p of players) {
    await db.execute({
      sql: `UPDATE players SET hand = '', current_bet = 0, status = 'active',
            has_acted = 0, total_invested = 0, visible_cards = ''
            WHERE table_id = ? AND fid = ?`,
      args: [tableId, p.fid],
    });
  }

  // Reset table
  await db.execute({
    sql: `UPDATE tables SET pot_size = 0, current_bet = 0, board = '',
          action_history = '', phase = 'preflop', deck = ?, status = 'playing',
          last_aggressor_fid = NULL
          WHERE id = ?`,
    args: [deck.join(','), tableId],
  });

  // Deal cards based on game type
  const config = getGameConfig(table.game_type);
  const holeCardCount = config.holeCardCount || 2;
  const activePlayers = players.filter(p => p.status !== 'waiting');

  let deckIdx = 0;
  for (const p of activePlayers) {
    const cards: string[] = [];
    for (let i = 0; i < holeCardCount; i++) {
      cards.push(deck[deckIdx++]);
    }
    await db.execute({
      sql: 'UPDATE players SET hand = ? WHERE table_id = ? AND fid = ?',
      args: [cards.join(','), tableId, p.fid],
    });
  }

  // Post blinds for blind games
  if (usesBlinds(table.game_type)) {
    await postBlinds(tableId, table.dealer_seat_index, activePlayers);
  }

  // Set first to act
  const firstActor = getFirstToActSeat(table.game_type, 'preflop', activePlayers, table.dealer_seat_index);
  const firstPlayer = activePlayers.find(p => p.seat_index === firstActor);
  if (firstPlayer) {
    await db.execute({
      sql: 'UPDATE tables SET current_turn_fid = ? WHERE id = ?',
      args: [firstPlayer.fid, tableId],
    });
  }
}

async function postBlinds(tableId: string, dealerSeat: number, players: Player[]): Promise<void> {
  const maxPlayers = players.length;
  const sbSeat = (dealerSeat + 1) % maxPlayers;
  const bbSeat = (dealerSeat + 2) % maxPlayers;

  const sbPlayer = players.find(p => p.seat_index === sbSeat);
  const bbPlayer = players.find(p => p.seat_index === bbSeat);

  const sbAmount = 5;  // Configurable
  const bbAmount = 10;

  if (sbPlayer) {
    const actual = Math.min(sbAmount, sbPlayer.stack_size);
    await db.execute({
      sql: `UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = ?
            WHERE table_id = ? AND fid = ?`,
      args: [actual, actual, actual, tableId, sbPlayer.fid],
    });
  }
  if (bbPlayer) {
    const actual = Math.min(bbAmount, bbPlayer.stack_size);
    await db.execute({
      sql: `UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = ?
            WHERE table_id = ? AND fid = ?`,
      args: [actual, actual, actual, tableId, bbPlayer.fid],
    });
  }

  await db.execute({
    sql: 'UPDATE tables SET pot_size = ?, current_bet = ? WHERE id = ?',
    args: [(sbPlayer ? Math.min(5, sbPlayer.stack_size) : 0) + (bbPlayer ? Math.min(10, bbPlayer.stack_size) : 0), bbAmount, tableId],
  });
}

function getFirstToActSeat(gameType: string, street: string, players: Player[], dealerSeat: number): number {
  const activePlayers = players.filter(p => p.status !== 'waiting');
  const maxPlayers = activePlayers.length;

  if (usesBlinds(gameType) && street === 'preflop') {
    // UTG (left of BB)
    return (dealerSeat + 3) % maxPlayers;
  }
  // Postflop: left of dealer
  return (dealerSeat + 1) % maxPlayers;
}

/**
 * Check if the current betting round is complete.
 * All active players have acted and bets are matched.
 */
export async function isBettingRoundComplete(tableId: string): Promise<boolean> {
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT current_bet FROM tables WHERE id = ?',
    args: [tableId],
  });
  if (tableRows.length === 0) return false;
  const table = tableRows[0] as unknown as { current_bet: number };

  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? AND status IN (?, ?)',
    args: [tableId, 'active', 'waiting'],
  });
  const players = playerRows as unknown as Player[];

  const activePlayers = players.filter(p => p.status === 'active');
  if (activePlayers.length <= 1) return true; // Hand over

  // All active players must have acted and matched the current bet
  for (const p of activePlayers) {
    if (p.has_acted === 0) return false;
    if (p.current_bet < table.current_bet && p.stack_size > 0) return false;
  }

  return true;
}

/**
 * Advance to the next street (preflop → flop → turn → river → showdown).
 */
export async function advanceStreet(tableId: string): Promise<void> {
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT * FROM tables WHERE id = ?',
    args: [tableId],
  });
  if (tableRows.length === 0) return;
  const table = tableRows[0] as unknown as Table;

  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index',
    args: [tableId],
  });
  const players = playerRows as unknown as Player[];

  // Check for single player remaining (everyone else folded)
  const activePlayers = players.filter(p => p.status === 'active');
  if (activePlayers.length === 1) {
    await awardPot(tableId, activePlayers[0]);
    return;
  }

  const nextStreet = getNextStreet(table.game_type, table.phase as any);
  if (!nextStreet || nextStreet === 'showdown') {
    await runShowdown(tableId);
    return;
  }

  // Deal community cards for the new street
  const deck = table.deck.split(',').filter(Boolean);
  const currentBoard = table.board ? table.board.split(',').filter(Boolean) : [];
  const cardsToDeal = nextStreet === 'flop' ? 3 : 1;
  const boardStartIdx = 52 - deck.length; // Approximate position in deck
  const newCards = deck.slice(boardStartIdx, boardStartIdx + cardsToDeal);
  const newBoard = [...currentBoard, ...newCards];

  // Reset bets for new street
  await db.execute({
    sql: `UPDATE players SET current_bet = 0, has_acted = 0
          WHERE table_id = ? AND status = 'active'`,
    args: [tableId],
  });

  await db.execute({
    sql: `UPDATE tables SET phase = ?, board = ?, current_bet = 0,
          last_aggressor_fid = NULL, action_history = action_history || ?
          WHERE id = ?`,
    args: [nextStreet, newBoard.join(','), `|${nextStreet}|`, tableId],
  });

  // Set first to act for new street
  const firstActor = getFirstToActSeat(table.game_type, nextStreet, players, table.dealer_seat_index);
  const firstPlayer = activePlayers.find(p => p.seat_index === firstActor);
  if (firstPlayer) {
    await db.execute({
      sql: 'UPDATE tables SET current_turn_fid = ? WHERE id = ?',
      args: [firstPlayer.fid, tableId],
    });
  }
}

/**
 * Award the entire pot to a single player (everyone else folded).
 */
async function awardPot(tableId: string, winner: Player): Promise<void> {
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT pot_size FROM tables WHERE id = ?',
    args: [tableId],
  });
  const pot = (tableRows[0] as any)?.pot_size || 0;

  await db.execute({
    sql: 'UPDATE players SET stack_size = stack_size + ? WHERE table_id = ? AND fid = ?',
    args: [pot, tableId, winner.fid],
  });

  await db.execute({
    sql: `UPDATE tables SET status = 'waiting', pot_size = 0, board = '',
          phase = 'preflop', action_history = action_history || '|foldwin|'
          WHERE id = ?`,
    args: [tableId],
  });

  // Record hand history
  await db.execute({
    sql: `INSERT INTO hand_history (table_id, fid, result, net_amount, pot_size, phase_reached, resolution)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [tableId, winner.fid, 'win', pot, pot, 'preflop', 'fold'],
  });
}

/**
 * Run showdown: evaluate all hands, award pot(s), record history.
 */
async function runShowdown(tableId: string): Promise<void> {
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT * FROM tables WHERE id = ?',
    args: [tableId],
  });
  if (tableRows.length === 0) return;
  const table = tableRows[0] as unknown as Table;

  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? AND status = ?',
    args: [tableId, 'active'],
  });
  const players = playerRows as unknown as Player[];

  const board = table.board ? table.board.split(',').filter(Boolean) : [];
  const pot = table.pot_size;

  // Build showdown entries
  const showdownEntries = players.map(p => ({
    seat: p.seat_index,
    fid: p.fid,
    holeCards: p.hand.split(',').filter(Boolean) as [string, string],
  }));

  let winners: { seat: number; fid: number; amount: number }[] = [];

  if (table.game_type === 'O8B') {
    // Omaha 8/b high-low split
    const omahaHands = showdownEntries.map(e => ({
      seat: e.seat,
      fid: e.fid,
      high: getBestOmaha8Hand(e.holeCards, board).high,
      low: getBestOmaha8Hand(e.holeCards, board).low,
    }));
    const result = rankHighLowShowdown(omahaHands);
    
    // Award high
    const highPot = Math.floor(pot * 0.5);
    for (const w of result.highWinners) {
      winners.push({ seat: w.seat, fid: w.fid, amount: Math.floor(highPot / result.highWinners.length) });
    }
    // Award low (if any qualifying)
    if (result.lowWinners.length > 0) {
      const lowPot = pot - highPot;
      for (const w of result.lowWinners) {
        winners.push({ seat: w.seat, fid: w.fid, amount: Math.floor(lowPot / result.lowWinners.length) });
      }
    }
  } else {
    // Standard high-hand poker
    const hands = showdownEntries.map(e => ({
      seat: e.seat,
      fid: e.fid,
      handRank: rankShowdownWinners([{ seat: e.seat, holeCards: e.holeCards }], board)[0]?.handRank,
    }));
    
    // Find best hand rank
    const bestRank = Math.max(...hands.map(h => h.handRank ?? -1));
    const potWinners = hands.filter(h => h.handRank === bestRank);
    
    const share = Math.floor(pot / potWinners.length);
    for (const w of potWinners) {
      winners.push({ seat: w.seat, fid: w.fid, amount: share });
    }
  }

  // Award winnings
  for (const w of winners) {
    await db.execute({
      sql: 'UPDATE players SET stack_size = stack_size + ? WHERE table_id = ? AND fid = ?',
      args: [w.amount, tableId, w.fid],
    });
  }

  // Record hand history for all players
  for (const p of players) {
    const isWinner = winners.some(w => w.fid === p.fid);
    const winAmount = winners.filter(w => w.fid === p.fid).reduce((s, w) => s + w.amount, 0);
    await db.execute({
      sql: `INSERT INTO hand_history (table_id, fid, hole_cards, board, result, net_amount, pot_size, phase_reached, resolution)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [tableId, p.fid, p.hand, table.board, isWinner ? 'win' : 'loss', winAmount - p.total_invested, pot, table.phase, 'showdown'],
    });
  }

  // Reset table for next hand
  await db.execute({
    sql: `UPDATE tables SET status = 'waiting', pot_size = 0, board = '',
          current_bet = 0, phase = 'preflop', action_history = action_history || '|showdown|',
          deck = '', last_aggressor_fid = NULL, current_turn_fid = NULL
          WHERE id = ?`,
    args: [tableId],
  });

  // Reset players
  await db.execute({
    sql: `UPDATE players SET hand = '', current_bet = 0, has_acted = 0,
          total_invested = 0, visible_cards = ''
          WHERE table_id = ?`,
    args: [tableId],
  });
}

/**
 * Get the next player's turn after an action.
 */
export async function getNextTurnSeat(tableId: string, currentSeat: number): Promise<number | null> {
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT * FROM tables WHERE id = ?',
    args: [tableId],
  });
  if (tableRows.length === 0) return null;
  const table = tableRows[0] as unknown as Table;

  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index',
    args: [tableId],
  });
  const players = playerRows as unknown as Player[];

  const activePlayers = players.filter(p => p.status === 'active');
  if (activePlayers.length <= 1) return null;

  const seats = activePlayers.map(p => p.seat_index).sort((a, b) => a - b);
  const currentIdx = seats.indexOf(currentSeat);
  const nextIdx = (currentIdx + 1) % seats.length;
  return seats[nextIdx];
}
