/**
 * ZAO Poker Game Engine — Hand lifecycle management.
 * 
 * Handles: dealing, betting rounds, street advancement, showdown,
 * side pots, and hand history recording.
 */

import { db } from './db';
import { bestHandRank, compareHandRanks, rankShowdownWinners, getBestOmaha8Hand, rankHighLowShowdown } from './poker-hand-evaluator';
import { getNextStreet, getGameConfig, usesBlinds, usesBoard, GameVariant } from './game-rules';

const FULL_DECK = [
  'As','Ks','Qs','Js','Ts','9s','8s','7s','6s','5s','4s','3s','2s',
  'Ah','Kh','Qh','Jh','Th','9h','8h','7h','6h','5h','4h','3h','2h',
  'Ad','Kd','Qd','Jd','Td','9d','8d','7d','6d','5d','4d','3d','2d',
  'Ac','Kc','Qc','Jc','Tc','9c','8c','7c','6c','5c','4c','3c','2c',
];

function shuffleDeck(seed: number): string[] {
  const deck = [...FULL_DECK];
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

  const seed = generateSeed();
  const deck = shuffleDeck(seed);

  for (const p of players) {
    await db.execute({
      sql: `UPDATE players SET hand = '', current_bet = 0, status = 'active',
            has_acted = 0, total_invested = 0, visible_cards = ''
            WHERE table_id = ? AND fid = ?`,
      args: [tableId, p.fid],
    });
  }

  await db.execute({
    sql: `UPDATE tables SET pot_size = 0, current_bet = 0, board = '',
          action_history = '', phase = 'preflop', deck = ?, status = 'playing',
          last_aggressor_fid = NULL
          WHERE id = ?`,
    args: [deck.join(','), tableId],
  });

  const config = getGameConfig(table.game_type as GameVariant);
  const holeCardCount = config.holeCardCount || 2;
  const activePlayers = players.filter(p => p.status !== 'waiting');
  const isStud = !usesBoard(config);

  let deckIdx = 0;
  for (const p of activePlayers) {
    const cards: string[] = [];
    for (let i = 0; i < holeCardCount; i++) {
      cards.push(deck[deckIdx++]);
    }
    
    let visibleCards = '';
    if (isStud && cards.length >= 3) {
      const visible = [cards[2]];
      if (cards.length >= 4) visible.push(cards[3]);
      if (cards.length >= 5) visible.push(cards[4]);
      if (cards.length >= 6) visible.push(cards[5]);
      visibleCards = visible.join(',');
    }
    
    await db.execute({
      sql: `UPDATE players SET hand = ?, visible_cards = ? 
            WHERE table_id = ? AND fid = ?`,
      args: [cards.join(','), visibleCards, tableId, p.fid],
    });
  }

  if (usesBlinds(config)) {
    await postBlinds(tableId, table.dealer_seat_index, activePlayers);
  } else if (isStud) {
    await postAnteAndBringIn(tableId, table.dealer_seat_index, activePlayers, table.game_type as GameVariant);
  }

  const firstActor = getFirstToActSeat(table.game_type as GameVariant, 'preflop', activePlayers, table.dealer_seat_index);
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

  const sbAmount = 5;
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

async function postAnteAndBringIn(tableId: string, _dealerSeat: number, players: Player[], gameType: GameVariant): Promise<void> {
  const config = getGameConfig(gameType);
  const anteAmount = Math.floor(10 * (config.anteMul || 0.25));
  const bringInAmount = Math.floor(10 * (config.bringInMul || 0.5));

  let totalPot = 0;
  for (const p of players) {
    const actual = Math.min(anteAmount, p.stack_size);
    if (actual > 0) {
      await db.execute({
        sql: `UPDATE players SET stack_size = stack_size - ?, total_invested = total_invested + ?
              WHERE table_id = ? AND fid = ?`,
        args: [actual, actual, tableId, p.fid],
      });
      totalPot += actual;
    }
  }

  const visibleCards: { seat: number; fid: number; card: string }[] = [];
  for (const p of players) {
    if (p.visible_cards) {
      const cards = p.visible_cards.split(',').filter(Boolean);
      if (cards.length > 0) {
        visibleCards.push({ seat: p.seat_index, fid: p.fid, card: cards[0] });
      }
    }
  }

  if (visibleCards.length > 0) {
    const sorted = visibleCards.sort((a, b) => {
      const rankOrder = '23456789TJQKA';
      const aVal = rankOrder.indexOf(a.card[0]);
      const bVal = rankOrder.indexOf(b.card[0]);
      if (aVal !== bVal) return aVal - bVal;
      const suitOrder = 'shcd';
      return suitOrder.indexOf(a.card[1]) - suitOrder.indexOf(b.card[1]);
    });
    const bringInPlayer = sorted[0];
    const actualBringIn = Math.min(bringInAmount, 
      players.find(p => p.fid === bringInPlayer.fid)?.stack_size ?? 0);
    
    if (actualBringIn > 0) {
      await db.execute({
        sql: `UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = total_invested + ?
              WHERE table_id = ? AND fid = ?`,
        args: [actualBringIn, actualBringIn, actualBringIn, tableId, bringInPlayer.fid],
      });
      totalPot += actualBringIn;
    }

    await db.execute({
      sql: 'UPDATE tables SET pot_size = ?, current_bet = ? WHERE id = ?',
      args: [totalPot, bringInAmount, tableId],
    });
  }
}

function getFirstToActSeat(gameType: GameVariant, street: string, players: Player[], dealerSeat: number): number {
  const activePlayers = players.filter(p => p.status !== 'waiting');
  const maxPlayers = activePlayers.length;
  const config = getGameConfig(gameType);

  if (usesBlinds(config) && street === 'preflop') {
    return (dealerSeat + 3) % maxPlayers;
  }
  
  if (!usesBlinds(config)) {
    if (street === 'preflop' || street === '3rd') {
      const withVisible = activePlayers.filter(p => p.visible_cards);
      if (withVisible.length > 0) {
        const rankOrder = '23456789TJQKA';
        const sorted = withVisible.sort((a, b) => {
          const aCard = a.visible_cards.split(',')[0];
          const bCard = b.visible_cards.split(',')[0];
          const aVal = rankOrder.indexOf(aCard[0]);
          const bVal = rankOrder.indexOf(bCard[0]);
          if (aVal !== bVal) return aVal - bVal;
          const suitOrder = 'shcd';
          return suitOrder.indexOf(aCard[1]) - suitOrder.indexOf(bCard[1]);
        });
        return sorted[0].seat_index;
      }
    }
  }
  
  return (dealerSeat + 1) % maxPlayers;
}

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
  if (activePlayers.length <= 1) return true;

  for (const p of activePlayers) {
    if (p.has_acted === 0) return false;
    if (p.current_bet < table.current_bet && p.stack_size > 0) return false;
  }

  return true;
}

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

  const activePlayers = players.filter(p => p.status === 'active');
  if (activePlayers.length === 1) {
    await awardPot(tableId, activePlayers[0]);
    return;
  }

  const config = getGameConfig(table.game_type as GameVariant);
  const nextStreet = getNextStreet(config, table.phase);
  if (!nextStreet || nextStreet.phase === 'showdown') {
    await runShowdown(tableId);
    return;
  }

  const deck = table.deck.split(',').filter(Boolean);
  const currentBoard = table.board ? table.board.split(',').filter(Boolean) : [];
  const cardsToDeal = nextStreet.phase === 'flop' ? 3 : 1;
  const boardStartIdx = 52 - deck.length;
  const newCards = deck.slice(boardStartIdx, boardStartIdx + cardsToDeal);
  const newBoard = [...currentBoard, ...newCards];

  await db.execute({
    sql: `UPDATE players SET current_bet = 0, has_acted = 0
          WHERE table_id = ? AND status = 'active'`,
    args: [tableId],
  });

  await db.execute({
    sql: `UPDATE tables SET phase = ?, board = ?, current_bet = 0,
          last_aggressor_fid = NULL, action_history = action_history || ?
          WHERE id = ?`,
    args: [nextStreet.phase, newBoard.join(','), `|${nextStreet.phase}|`, tableId],
  });

  const firstActor = getFirstToActSeat(table.game_type as GameVariant, nextStreet.phase, players, table.dealer_seat_index);
  const firstPlayer = activePlayers.find(p => p.seat_index === firstActor);
  if (firstPlayer) {
    await db.execute({
      sql: 'UPDATE tables SET current_turn_fid = ? WHERE id = ?',
      args: [firstPlayer.fid, tableId],
    });
  }
}

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

  await db.execute({
    sql: `INSERT INTO hand_history (table_id, fid, result, net_amount, pot_size, phase_reached, resolution)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [tableId, winner.fid, 'win', pot, pot, 'preflop', 'fold'],
  });
}

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

  let winners: { fid: number; amount: number }[] = [];

  if (table.game_type === 'O8B') {
    // Omaha 8/b high-low split
    const omahaHands = players.map(p => ({
      fid: p.fid,
      holeCards: p.hand.split(',').filter(Boolean),
    }));
    
    const highLowPlayers = omahaHands.map(h => ({
      fid: h.fid,
      username: '',
      holeCards: h.holeCards,
      invested: 0,
    }));
    
    const result = rankHighLowShowdown(highLowPlayers, board, 'O8B');
    
    const highPot = Math.floor(pot * 0.5);
    for (const fid of result.highWinners) {
      winners.push({ fid, amount: Math.floor(highPot / result.highWinners.length) });
    }
    if (result.lowWinners.length > 0) {
      const lowPot = pot - highPot;
      for (const fid of result.lowWinners) {
        winners.push({ fid, amount: Math.floor(lowPot / result.lowWinners.length) });
      }
    }
  } else {
    // Standard high-hand poker
    const hands = players.map(p => ({
      fid: p.fid,
      rank: bestHandRank(p.hand.split(',').filter(Boolean), board),
    }));
    
    const bestRank = hands.reduce((best, h) => compareHandRanks(h.rank, best) > 0 ? h.rank : best, hands[0].rank);
    const potWinners = hands.filter(h => compareHandRanks(h.rank, bestRank) === 0);
    
    const share = Math.floor(pot / potWinners.length);
    for (const w of potWinners) {
      winners.push({ fid: w.fid, amount: share });
    }
  }

  for (const w of winners) {
    await db.execute({
      sql: 'UPDATE players SET stack_size = stack_size + ? WHERE table_id = ? AND fid = ?',
      args: [w.amount, tableId, w.fid],
    });
  }

  for (const p of players) {
    const isWinner = winners.some(w => w.fid === p.fid);
    const winAmount = winners.filter(w => w.fid === p.fid).reduce((s, w) => s + w.amount, 0);
    await db.execute({
      sql: `INSERT INTO hand_history (table_id, fid, hole_cards, board, result, net_amount, pot_size, phase_reached, resolution)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [tableId, p.fid, p.hand, table.board, isWinner ? 'win' : 'loss', winAmount - p.total_invested, pot, table.phase, 'showdown'],
    });
  }

  await db.execute({
    sql: `UPDATE tables SET status = 'waiting', pot_size = 0, board = '',
          current_bet = 0, phase = 'preflop', action_history = action_history || '|showdown|',
          deck = '', last_aggressor_fid = NULL, current_turn_fid = NULL
          WHERE id = ?`,
    args: [tableId],
  });

  await db.execute({
    sql: `UPDATE players SET hand = '', current_bet = 0, has_acted = 0,
          total_invested = 0, visible_cards = ''
          WHERE table_id = ?`,
    args: [tableId],
  });
}

export async function getNextTurnSeat(tableId: string, currentSeat: number): Promise<number | null> {
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
