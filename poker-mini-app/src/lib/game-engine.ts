/**
 * ZAO Poker Game Engine — Hand lifecycle management.
 * 
 * Handles: dealing, betting rounds, street advancement, showdown,
 * side pots, and hand history recording.
 */

import { db } from './db';

import { getNextStreet, getGameConfig, usesBlinds, usesBoard, GameVariant, getFirstToAct, calculateBringIn, PlayerForActing } from './game-rules';
import { resolveShowdown } from './hand-history';
import { BET_ABSTRACTION } from './poker/abstraction';

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

  // Update table deck
  const remainingDeck = deck.slice(deckIdx);
  await db.execute({
    sql: 'UPDATE tables SET deck = ? WHERE id = ?',
    args: [remainingDeck.join(','), tableId],
  });

  // Re-fetch players to get correct hand/visible_cards details
  const { rows: refetchedPlayerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index',
    args: [tableId],
  });
  const refetchedPlayers = refetchedPlayerRows as unknown as Player[];
  const refetchedActive = refetchedPlayers.filter(p => p.status !== 'waiting');

  if (usesBlinds(config)) {
    await postBlinds(tableId, table.dealer_seat_index, refetchedActive);
  } else if (isStud) {
    await postAnteAndBringIn(tableId, table.dealer_seat_index, refetchedActive, table.game_type as GameVariant);
  }

  // Re-fetch players again to get correct blinds/antes post status
  const { rows: finalPlayersRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index',
    args: [tableId],
  });
  const finalActivePlayers = (finalPlayersRows as unknown as Player[]).filter(p => p.status === 'active');

  const firstActor = getFirstToActSeat(table.game_type as GameVariant, 'preflop', finalActivePlayers, table.dealer_seat_index);
  const firstPlayer = finalActivePlayers.find(p => p.seat_index === firstActor);
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

  const playersForBringIn = players.map(p => ({
    fid: p.fid,
    seatIndex: p.seat_index,
    visibleCards: p.visible_cards ? p.visible_cards.split(',').filter(Boolean) : [],
  }));

  const { bringInFid, amount: bringInAmount } = calculateBringIn(config, playersForBringIn, 10);

  if (bringInFid !== null) {
    const p = players.find(x => x.fid === bringInFid);
    if (p) {
      const actualBringIn = Math.min(bringInAmount, p.stack_size);
      if (actualBringIn > 0) {
        await db.execute({
          sql: `UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = total_invested + ?
                WHERE table_id = ? AND fid = ?`,
          args: [actualBringIn, actualBringIn, actualBringIn, tableId, bringInFid],
        });
        totalPot += actualBringIn;
      }
      
      await db.execute({
        sql: 'UPDATE tables SET pot_size = ?, current_bet = ? WHERE id = ?',
        args: [totalPot, bringInAmount, tableId],
      });
      return;
    }
  }

  await db.execute({
    sql: 'UPDATE tables SET pot_size = ?, current_bet = 0 WHERE id = ?',
    args: [totalPot, tableId],
  });
}

function getFirstToActSeat(gameType: GameVariant, street: string, players: Player[], dealerSeat: number): number {
  const config = getGameConfig(gameType);
  const playersForActing: PlayerForActing[] = players.map(p => ({
    fid: p.fid,
    seatIndex: p.seat_index,
    hand: p.hand ? p.hand.split(',').filter(Boolean) : [],
    visibleCards: p.visible_cards ? p.visible_cards.split(',').filter(Boolean) : [],
    status: p.status,
  }));
  const firstToActFid = getFirstToAct(config, street, playersForActing, dealerSeat);
  if (firstToActFid !== null) {
    const p = players.find(x => x.fid === firstToActFid);
    if (p) return p.seat_index;
  }
  
  // Fallback
  const activePlayers = players.filter(p => p.status === 'active');
  return activePlayers[0]?.seat_index ?? 0;
}

export async function isBettingRoundComplete(tableId: string): Promise<boolean> {
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT current_bet FROM tables WHERE id = ?',
    args: [tableId],
  });
  if (tableRows.length === 0) return false;
  const table = tableRows[0] as unknown as { current_bet: number };

  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ?',
    args: [tableId],
  });
  const players = playerRows as unknown as Player[];

  const activePlayers = players.filter(p => p.status === 'active');
  if (activePlayers.length <= 1) return true;

  for (const p of activePlayers) {
    if (p.stack_size > 0) {
      if (p.has_acted === 0) return false;
      if (p.current_bet < table.current_bet) return false;
    }
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
  let newBoard = [...currentBoard];
  let remainingDeck = [...deck];

  if (usesBoard(config)) {
    const cardsToDeal = nextStreet.phase === 'flop' ? 3 : 1;
    const boardStartIdx = 52 - deck.length;
    const newCards = deck.slice(boardStartIdx, boardStartIdx + cardsToDeal);
    newBoard = [...currentBoard, ...newCards];
    remainingDeck = deck.slice(boardStartIdx + cardsToDeal);
  } else {
    // Stud: update visible cards for active players
    for (const p of activePlayers) {
      const cards = p.hand.split(',').filter(Boolean);
      let visibleCards = '';
      if (nextStreet.phase === '4th') visibleCards = cards.slice(2, 4).join(',');
      else if (nextStreet.phase === '5th') visibleCards = cards.slice(2, 5).join(',');
      else if (nextStreet.phase === '6th') visibleCards = cards.slice(2, 6).join(',');
      else if (nextStreet.phase === '7th') visibleCards = cards.slice(2, 6).join(','); // 7th card is face down
      
      if (visibleCards) {
        await db.execute({
          sql: 'UPDATE players SET visible_cards = ? WHERE table_id = ? AND fid = ?',
          args: [visibleCards, tableId, p.fid],
        });
      }
    }
  }

  await db.execute({
    sql: `UPDATE players SET current_bet = 0, has_acted = 0
          WHERE table_id = ? AND status = 'active'`,
    args: [tableId],
  });

  await db.execute({
    sql: `UPDATE tables SET phase = ?, board = ?, deck = ?, current_bet = 0,
          last_aggressor_fid = NULL, action_history = action_history || ?
          WHERE id = ?`,
    args: [nextStreet.phase, newBoard.join(','), remainingDeck.join(','), `|${nextStreet.phase}|`, tableId],
  });

  // Re-fetch players after state update
  const { rows: updatedPlayerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index',
    args: [tableId],
  });
  const updatedPlayers = updatedPlayerRows as unknown as Player[];
  const updatedActivePlayers = updatedPlayers.filter(p => p.status === 'active');

  const activeWithChips = updatedActivePlayers.filter(p => p.stack_size > 0);
  if (activeWithChips.length <= 1) {
    // No more betting possible (everyone is all-in, or all-in except one player).
    // Automatically advance to the next street!
    await advanceStreet(tableId);
    return;
  }

  const firstActor = getFirstToActSeat(table.game_type as GameVariant, nextStreet.phase, updatedPlayers, table.dealer_seat_index);
  const firstPlayer = updatedActivePlayers.find(p => p.seat_index === firstActor);
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

  // Delegate complete side pot and hand calculation to hand-history's resolveShowdown
  await resolveShowdown(tableId, table.pot_size, table.board, table.game_type as GameVariant);

  // Clean up table and player states for next hand
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

  const actingPlayers = players.filter(p => p.status === 'active' && p.stack_size > 0);
  if (actingPlayers.length <= 1) return null;

  const seats = actingPlayers.map(p => p.seat_index).sort((a, b) => a - b);
  const currentIdx = seats.indexOf(currentSeat);
  if (currentIdx === -1) {
    const nextSeat = seats.find(s => s > currentSeat) ?? seats[0];
    return nextSeat;
  }
  const nextIdx = (currentIdx + 1) % seats.length;
  return seats[nextIdx];
}

export async function applyAction(
  tableId: string,
  seatIndex: number,
  actionType: number,
  amount: number
): Promise<{ advanced: boolean; nextSeat: number | null }> {
  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index',
    args: [tableId],
  });
  const players = playerRows as unknown as Player[];
  const player = players.find(p => p.seat_index === seatIndex);
  if (!player) return { advanced: false, nextSeat: null };

  const { rows: tableRows } = await db.execute({
    sql: 'SELECT * FROM tables WHERE id = ?',
    args: [tableId],
  });
  if (tableRows.length === 0) return { advanced: false, nextSeat: null };
  const table = tableRows[0] as unknown as Table;

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

  // Mark player as acted
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

  // Check if betting round is complete and advance if so
  const isComplete = await isBettingRoundComplete(tableId);
  if (isComplete) {
    await advanceStreet(tableId);
    return { advanced: true, nextSeat: null };
  }

  // Otherwise, get next player's turn
  const nextSeat = await getNextTurnSeat(tableId, seatIndex);
  if (nextSeat !== null) {
    const nextPlayer = players.find(p => p.seat_index === nextSeat);
    if (nextPlayer) {
      await db.execute({
        sql: 'UPDATE tables SET current_turn_fid = ? WHERE id = ?',
        args: [nextPlayer.fid, tableId],
      });
    }
  }

  return { advanced: false, nextSeat };
}
