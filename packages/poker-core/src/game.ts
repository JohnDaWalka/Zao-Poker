import { BLIND_LEVELS, AUTOPLAY_MAX_TURNS } from './types.js';
import { GameDb } from './db.js';

// 52-card deck generator and shuffler
export function createDeck(): string[] {
  const suits = ["h", "d", "c", "s"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck: string[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(rank + suit);
    }
  }
  // Fisher-Yates Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function encodeActionEntry(actor: string, action: string, amount?: number) {
  const normalizedActor = actor.replace(/[^a-zA-Z0-9_-]/g, "");
  const normalizedAction = action.replace(/[^a-zA-Z0-9_-]/g, "");
  const normalizedAmount =
    typeof amount === "number" && Number.isFinite(amount)
      ? `:${Math.round(amount)}`
      : "";
  return `${normalizedActor}:${normalizedAction}${normalizedAmount}`;
}

export function parseActionHistory(raw: unknown): string[] {
  return String(raw || "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getCurrentBlinds(startTimeStr: string | null) {
  if (!startTimeStr) return { levelIndex: 0, blinds: BLIND_LEVELS[0], nextLevelInSecs: 360 };

  const start = new Date(startTimeStr).getTime();
  const now = Date.now();
  const elapsedMs = Math.max(0, now - start);
  const levelDurationMs = 6 * 60 * 1000;

  let levelIndex = Math.floor(elapsedMs / levelDurationMs);
  if (levelIndex >= BLIND_LEVELS.length) {
    levelIndex = BLIND_LEVELS.length - 1;
  }

  const nextLevelTimeMs = start + (levelIndex + 1) * levelDurationMs;
  const nextLevelInSecs = Math.max(0, Math.floor((nextLevelTimeMs - now) / 1000));

  return { levelIndex, blinds: BLIND_LEVELS[levelIndex], nextLevelInSecs };
}

export function isBotPlayer(player: any) {
  return Number(player?.is_bot || 0) === 1;
}

// Basic AI decision (simplified version of evaluateAIAction for shared use)
// Full version with analyzeHoldemSpot can be imported from game-theory in consuming apps
export function getBasicAiDecision(
  toCall: number,
  potSize: number,
  stackSize: number,
  phase: string
): { action: "fold" | "call" | "check" | "raise" | "bet"; targetBet: number | null } {
  if (toCall === 0) {
    // Prefer check or small bet postflop
    if (phase !== "preflop" && Math.random() > 0.6) {
      const bet = Math.max(1, Math.floor(potSize * 0.5));
      return { action: "bet", targetBet: Math.min(bet, stackSize) };
    }
    return { action: "check", targetBet: null };
  }

  const facingLarge = toCall > potSize;
  if (facingLarge && Math.random() > 0.3) {
    return { action: "fold", targetBet: null };
  }

  if (Math.random() > 0.7) {
    const raiseTo = toCall * 2 + Math.floor(potSize * 0.3);
    return { action: "raise", targetBet: Math.min(raiseTo, stackSize + toCall) };
  }

  return { action: "call", targetBet: null };
}

// Deal a new hand (Preflop) - DB operations via injected GameDb
export async function dealNewHand(db: GameDb, tableId: string, fids: number[]) {
  // Ensure clean slate for new hand - fixes "same cards" persistence bug between hands
  await db.execute({
    sql: "UPDATE players SET hand = '', current_bet = 0, has_acted = 0, status = 'waiting' WHERE table_id = ?",
    args: [tableId]
  });
  await db.execute({
    sql: "UPDATE tables SET board = '', deck = '', action_history = '', phase = 'preflop', pot_size = 0, current_bet = 0, current_turn_fid = NULL WHERE id = ?",
    args: [tableId]
  });

  const deck = createDeck();

  // Get table's start_time to calculate blinds
  const { rows: tableRows } = await db.execute({
    sql: "SELECT start_time FROM tables WHERE id = ?",
    args: [tableId]
  });
  const startTime = tableRows[0]?.start_time;
  const { blinds } = getCurrentBlinds(startTime ? String(startTime) : null);

  let potSize = 0;
  let highestPostedBlind = 0;

  // New hand: reset each player's running "chips invested this hand"
  await db.execute({
    sql: "UPDATE players SET total_invested = 0 WHERE table_id = ?",
    args: [tableId]
  });

  // Deduct ante from all players
  if (blinds.ante > 0) {
    for (const fid of fids) {
      const { rows: pRows } = await db.execute({
        sql: "SELECT stack_size FROM players WHERE fid = ? AND table_id = ?",
        args: [fid, tableId]
      });
      const stack = Number(pRows[0]?.stack_size || 0);
      const actualAnte = Math.min(stack, blinds.ante);

      if (actualAnte > 0) {
        await db.execute({
          sql: "UPDATE players SET stack_size = stack_size - ?, total_invested = total_invested + ? WHERE fid = ? AND table_id = ?",
          args: [actualAnte, actualAnte, fid, tableId]
        });
        potSize += actualAnte;
      }
    }
  }

  // Determine blinds and turns based on seat order
  let sbFid = fids[0];
  let bbFid = fids.length > 1 ? fids[1] : fids[0];
  let currentTurnFid = fids.length === 2 ? fids[0] : (fids.length > 2 ? fids[2] : fids[0]);
  let lastAggressorFid = bbFid;

  // Deal 2 cards to each player and post blinds
  for (const fid of fids) {
    const c1 = deck.pop();
    const c2 = deck.pop();
    const hand = `${c1},${c2}`;

    let blindAmount = 0;
    if (fid === sbFid) blindAmount = blinds.sb;
    if (fid === bbFid) blindAmount = blinds.bb;
    const { rows: stackRows } = await db.execute({
      sql: "SELECT stack_size FROM players WHERE fid = ? AND table_id = ?",
      args: [fid, tableId],
    });
    const stack = Number(stackRows[0]?.stack_size || 0);
    const actualBlind = Math.min(stack, blindAmount);

    potSize += actualBlind;
    highestPostedBlind = Math.max(highestPostedBlind, actualBlind);

    await db.execute({
      sql: "UPDATE players SET hand = ?, current_bet = ?, stack_size = stack_size - ?, total_invested = total_invested + ?, status = 'playing', is_ready = 0, has_acted = 0 WHERE fid = ? AND table_id = ?",
      args: [hand, actualBlind, actualBlind, actualBlind, fid, tableId]
    });
  }

  const deckStr = deck.join(",");

  // Initialize pot
  await db.execute({
    sql: "UPDATE tables SET pot_size = ?, current_bet = ?, board = '', deck = ?, action_history = '', phase = 'preflop', status = 'playing', current_turn_fid = ?, last_aggressor_fid = ?, turn_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [potSize, highestPostedBlind, deckStr, currentTurnFid, lastAggressorFid, tableId]
  });

  console.log(`[poker:${tableId}] dealNewHand: preflop started. blinds sb=${blinds.sb} bb=${blinds.bb} ante=${blinds.ante} pot=${potSize} firstToAct=${currentTurnFid}`);
}

// Advance game to next street
export async function advanceGame(db: GameDb, tableId: string, currentState: any) {
  const phase = currentState.phase;
  const boardStr = currentState.board;
  const deckStr = currentState.deck;

  const deck = deckStr ? deckStr.split(",") : [];
  const board = boardStr ? boardStr.split(",") : [];

  console.log(`[poker:${tableId}] advanceGame: ${phase} -> dealing next street (current board cards: ${board.length})`);

  // Reset betting and has_acted for the next street
  await db.execute({
    sql: "UPDATE players SET current_bet = 0, has_acted = 0 WHERE table_id = ?",
    args: [tableId]
  });

  let nextPhase = phase;
  if (phase === "preflop") {
    const c1 = deck.pop(); const c2 = deck.pop(); const c3 = deck.pop();
    if (c1 && c2 && c3) board.push(c1, c2, c3);
    nextPhase = 'flop';
  } else if (phase === "flop") {
    const c = deck.pop(); if (c) board.push(c);
    nextPhase = 'turn';
  } else if (phase === "turn") {
    const c = deck.pop(); if (c) board.push(c);
    nextPhase = 'river';
  } else if (phase === "river") {
    nextPhase = 'showdown';
  }

  console.log(`[poker:${tableId}] dealt to ${nextPhase}, board now has ${board.length} cards`);

  let newCurrentTurnFid = currentState.current_turn_fid;
  if (nextPhase !== "showdown") {
    const { rows: activePlayers } = await db.execute({
      sql: "SELECT fid FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC",
      args: [tableId]
    });
    if (activePlayers.length > 0) {
      const startIdx = activePlayers.length === 2 ? 1 : 0;
      newCurrentTurnFid = activePlayers[startIdx].fid;
    }
  }

  await db.execute({
    sql: "UPDATE tables SET board = ?, deck = ?, phase = ?, current_bet = 0, current_turn_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [board.join(","), deck.join(","), nextPhase, newCurrentTurnFid, tableId]
  });

  if (nextPhase === "showdown") {
    console.log(`[poker:${tableId}] showdown reached, resolving pot`);
    // Note: resolveShowdown should be called by caller with full logic
  }
}

