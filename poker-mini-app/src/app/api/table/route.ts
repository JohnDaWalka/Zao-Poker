import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";
import { analyzeHoldemSpot } from "~/lib/game-theory";
import { resolveFoldWin, resolveShowdown } from "~/lib/hand-history";

let dbReady: Promise<void> | null = null;

function ensureDb() {
  if (!dbReady) {
    dbReady = initDb().catch((error) => {
      dbReady = null;
      throw error;
    });
  }
  return dbReady;
}

// 52-card deck generator and shuffler
function createDeck(): string[] {
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

function encodeActionEntry(actor: string, action: string, amount?: number) {
  const normalizedActor = actor.replace(/[^a-zA-Z0-9_-]/g, "");
  const normalizedAction = action.replace(/[^a-zA-Z0-9_-]/g, "");
  const normalizedAmount =
    typeof amount === "number" && Number.isFinite(amount)
      ? `:${Math.round(amount)}`
      : "";
  return `${normalizedActor}:${normalizedAction}${normalizedAmount}`;
}

function parseActionHistory(raw: unknown) {
  return String(raw || "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function appendActionHistory(
  tableId: string,
  actor: string,
  action: string,
  amount?: number,
) {
  const entry = encodeActionEntry(actor, action, amount);
  await db.execute({
    sql: `
      UPDATE tables
      SET action_history = CASE
        WHEN action_history IS NULL OR action_history = '' THEN ?
        ELSE action_history || '|' || ?
      END,
      updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [entry, entry, tableId],
  });
}

// Blind levels (6-minute intervals). Ante is fixed at 25% of the Big Blind.
const AUTOPLAY_MAX_TURNS = 12;
const BLIND_LEVELS = [
  { sb: 5, bb: 10, ante: 2.5 },
  { sb: 10, bb: 20, ante: 5 },
  { sb: 15, bb: 30, ante: 7.5 },
  { sb: 25, bb: 50, ante: 12.5 },
  { sb: 50, bb: 100, ante: 25 },
  { sb: 75, bb: 150, ante: 37.5 },
  { sb: 100, bb: 200, ante: 50 },
  { sb: 150, bb: 300, ante: 75 },
  { sb: 200, bb: 400, ante: 100 },
  { sb: 300, bb: 600, ante: 150 },
  { sb: 400, bb: 800, ante: 200 },
  { sb: 500, bb: 1000, ante: 250 },
  { sb: 600, bb: 1200, ante: 300 },
  { sb: 800, bb: 1600, ante: 400 },
  { sb: 1000, bb: 2000, ante: 500 },
  { sb: 1500, bb: 3000, ante: 750 },
  { sb: 2000, bb: 4000, ante: 1000 },
  { sb: 3000, bb: 6000, ante: 1500 },
  { sb: 4000, bb: 8000, ante: 2000 },
  { sb: 5000, bb: 10000, ante: 2500 },
  { sb: 6000, bb: 12000, ante: 3000 }
];

const DEFAULT_LOBBY_BOTS: Record<
  string,
  { fid: number; username: string; pfp_url: string; preferredSeat: number }
> = {
  room_1: {
    fid: 1,
    username: "PokerCoachJohnny",
    pfp_url: "https://i.imgur.com/k2j4j3V.jpeg",
    preferredSeat: 1,
  },
  room_2: {
    fid: 900001,
    username: "OrbitGrinder",
    pfp_url: "https://i.imgur.com/k2j4j3V.jpeg",
    preferredSeat: 1,
  },
  room_3: {
    fid: 900002,
    username: "RangeSpectre",
    pfp_url: "https://i.imgur.com/k2j4j3V.jpeg",
    preferredSeat: 1,
  },
};

function isBotPlayer(player: any) {
  return Number(player?.is_bot || 0) === 1;
}

function getCurrentBlinds(startTimeStr: string | null) {
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

function evaluateAIAction(
  aiHandStr: string,
  boardStr: string,
  toCall: number,
  potSize: number,
  stackSize: number,
  actionHistory: string[] = [],
): { action: "fold" | "call" | "raise" | "check" | "bet"; targetBet: number | null } {
  if (!aiHandStr) {
    return { action: "fold", targetBet: null };
  }

  const aiHand = aiHandStr.split(",").filter(Boolean);
  if (aiHand.length < 2) {
    return { action: "fold", targetBet: null };
  }

  const boardCards = boardStr ? boardStr.split(",").filter(Boolean) : [];
  const analysis = analyzeHoldemSpot({
    holeCards: aiHand,
    boardCards,
    potSize,
    toCall,
    stackSize,
    opponentCount: 1,
    position: "oop",
    history: actionHistory,
    iterations: 220,
    trials: 320,
  });

  if (analysis.recommendedAction === "raise" || analysis.recommendedAction === "bet") {
    const targetBet = Math.min(
      stackSize,
      Math.max(toCall > 0 ? toCall * 2.5 : Math.round(Math.max(potSize, 20) * 0.65), 20),
    );
    return { action: analysis.recommendedAction, targetBet };
  }

  return {
    action: analysis.recommendedAction,
    targetBet: null,
  };
}

// Deal a new hand (Preflop)
async function dealNewHand(tableId: string, fids: number[]) {
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

  // New hand: reset each player's running "chips invested this hand" so
  // hand_history/player_stats can compute accurate net win/loss later.
  await db.execute({
    sql: "UPDATE players SET total_invested = 0 WHERE table_id = ?",
    args: [tableId]
  });

  // Deduct ante from all players
  if (blinds.ante > 0) {
    for (const fid of fids) {
      // Find player stack
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
    if (fid === bbFid) blindAmount = blinds.bb; // if sb=bb, bb overrides
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
}

// Advance game to next street
async function advanceGame(tableId: string, currentState: any) {
  const phase = currentState.phase;
  const boardStr = currentState.board;
  const deckStr = currentState.deck;
  
  const deck = deckStr ? deckStr.split(",") : [];
  const board = boardStr ? boardStr.split(",") : [];

  // Reset betting and has_acted for the next street
  await db.execute({
    sql: "UPDATE players SET current_bet = 0, has_acted = 0 WHERE table_id = ?",
    args: [tableId]
  });

  let nextPhase = phase;
  if (phase === "preflop") {
    // Deal Flop (3 cards)
    const c1 = deck.pop(); const c2 = deck.pop(); const c3 = deck.pop();
    if (c1 && c2 && c3) board.push(c1, c2, c3);
    nextPhase = 'flop';
  } else if (phase === "flop") {
    // Deal Turn (1 card)
    const c = deck.pop(); if (c) board.push(c);
    nextPhase = 'turn';
  } else if (phase === "turn") {
    // Deal River (1 card)
    const c = deck.pop(); if (c) board.push(c);
    nextPhase = 'river';
  } else if (phase === "river") {
    nextPhase = 'showdown';
  }

  // Determine next player to act post-flop
  let newCurrentTurnFid = currentState.current_turn_fid;
  if (nextPhase !== "showdown") {
    const { rows: activePlayers } = await db.execute({
      sql: "SELECT fid FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC",
      args: [tableId]
    });
    if (activePlayers.length > 0) {
       // Post-flop, the player to the left of the button acts first.
       // In Heads-up (or generally), seat_index 1 acts first.
       newCurrentTurnFid = activePlayers.length > 1 ? activePlayers[1].fid : activePlayers[0].fid;
    }
  }

  await db.execute({
    sql: "UPDATE tables SET board = ?, deck = ?, phase = ?, current_bet = 0, current_turn_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [board.join(","), deck.join(","), nextPhase, newCurrentTurnFid, tableId]
  });

  // Showdowns previously just set phase='showdown' without ever comparing
  // hands or crediting the pot to a winner — fix that here so the pot
  // always resolves to someone's stack, and log the result for stats.
  if (nextPhase === "showdown") {
    await resolveShowdown(tableId, Number(currentState.pot_size || 0), board.join(","));
  }
}

function getNormalizedLobbyStatus(tableState: any, playerCount: number) {
  const maxPlayers = Number(tableState.max_players || 6);

  if (tableState.status === "playing") {
    return "in_game";
  }

  if (playerCount >= maxPlayers) {
    return "full";
  }

  if (playerCount > 0) {
    return "seated";
  }

  return "waiting";
}

function getTableMetadata(tableState: any) {
  return {
    game_type: String(tableState.game_type || "NLHE"),
    stakes_label: String(tableState.stakes_label || "$0.50 / $1"),
    buy_in: Number(tableState.buy_in || 50),
  };
}

function createCustomTableId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `table_${slug || "custom"}_${Date.now().toString(36)}`;
}

function getLowestOpenSeat(players: any[], maxPlayers: number) {
  const occupiedSeats = new Set(
    players
      .map((player) => Number(player.seat_index))
      .filter((seatIndex) => Number.isInteger(seatIndex) && seatIndex >= 0),
  );

  for (let seatIndex = 0; seatIndex < maxPlayers; seatIndex += 1) {
    if (!occupiedSeats.has(seatIndex)) {
      return seatIndex;
    }
  }

  return maxPlayers;
}

async function ensureAutoplayBot(tableId: string) {
  const botProfile = DEFAULT_LOBBY_BOTS[tableId];
  if (!botProfile) {
    return;
  }

  const { rows: tableRows } = await db.execute({
    sql: "SELECT status, max_players FROM tables WHERE id = ?",
    args: [tableId],
  });
  const tableState = tableRows[0];
  if (!tableState) {
    return;
  }

  const { rows: players } = await db.execute({
    sql: "SELECT fid, seat_index, is_bot FROM players WHERE table_id = ? ORDER BY seat_index ASC",
    args: [tableId],
  });

  const humans = players.filter((player: any) => !isBotPlayer(player));
  const bots = players.filter((player: any) => isBotPlayer(player));
  const maxPlayers = Number(tableState.max_players || 6);

  if (humans.length === 0 && tableState.status === "playing") {
    await db.execute({
      sql: "DELETE FROM players WHERE table_id = ?",
      args: [tableId],
    });
    await db.execute({
      sql: "UPDATE tables SET status = 'waiting', pot_size = 0, current_bet = 0, board = '', deck = '', action_history = '', phase = 'preflop', current_turn_fid = NULL, last_aggressor_fid = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [tableId],
    });
    players.length = 0;
    bots.length = 0;
  }

  if (humans.length >= 2 && tableState.status !== "playing" && bots.length > 0) {
    await db.execute({
      sql: "DELETE FROM players WHERE table_id = ? AND is_bot = 1",
      args: [tableId],
    });
    return;
  }

  if (humans.length <= 1 && bots.length === 0) {
    const preferredSeatOpen = !players.some(
      (player: any) => Number(player.seat_index) === botProfile.preferredSeat,
    );
    const seatIndex = preferredSeatOpen
      ? botProfile.preferredSeat
      : getLowestOpenSeat(players, maxPlayers);

    await db.execute({
      sql: `
        INSERT OR REPLACE INTO players (
          fid,
          username,
          pfp_url,
          table_id,
          seat_index,
          stack_size,
          hand,
          current_bet,
          status,
          is_bot,
          is_ready,
          has_acted,
          total_invested,
          last_seen
        )
        VALUES (?, ?, ?, ?, ?, 5000, '', 0, 'waiting', 1, 1, 0, 0, CURRENT_TIMESTAMP)
      `,
      args: [
        botProfile.fid,
        botProfile.username,
        botProfile.pfp_url,
        tableId,
        seatIndex,
      ],
    });
  } else if (bots.length > 1) {
    const extraBotFids = bots.slice(1).map((player: any) => Number(player.fid));
    if (extraBotFids.length > 0) {
      await db.execute({
        sql: `DELETE FROM players WHERE table_id = ? AND fid IN (${extraBotFids.map(() => "?").join(", ")})`,
        args: [tableId, ...extraBotFids],
      });
    }
  }
}

async function ensureDefaultLobbyBots() {
  for (const tableId of Object.keys(DEFAULT_LOBBY_BOTS)) {
    await ensureAutoplayBot(tableId);
  }
}

function shouldStartAutoplayHand(tableState: any, players: any[]) {
  if (!tableState || players.length < 2 || tableState.status === "playing") {
    return false;
  }

  const humans = players.filter((player: any) => !isBotPlayer(player));
  const bots = players.filter((player: any) => isBotPlayer(player));
  if (humans.length > 0 && bots.length > 0) {
    return true;
  }

  const startTime = tableState.start_time
    ? new Date(String(tableState.start_time)).getTime()
    : null;
  return startTime !== null && startTime <= Date.now();
}

function hasHumanAndBot(players: any[]) {
  const humans = players.filter((player: any) => !isBotPlayer(player));
  const bots = players.filter((player: any) => isBotPlayer(player));
  return humans.length > 0 && bots.length > 0;
}

async function refreshAutoplayStartTime(tableId: string, players: any[]) {
  if (!hasHumanAndBot(players)) {
    return;
  }

  await db.execute({
    sql: "UPDATE tables SET start_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [tableId],
  });
}

async function playAutomatedTurn(tableId: string) {
  const { rows: stateRows } = await db.execute({
    sql: "SELECT * FROM tables WHERE id = ?",
    args: [tableId],
  });
  const currentGameState = stateRows[0];
  if (!currentGameState || currentGameState.status !== "playing" || !currentGameState.current_turn_fid) {
    return false;
  }

  const { rows: remainingActive } = await db.execute({
    sql: `
      SELECT fid, current_bet, has_acted, hand, stack_size, is_bot
      FROM players
      WHERE table_id = ? AND status = 'playing'
      ORDER BY seat_index ASC
    `,
    args: [tableId],
  });

  const aiPlayer = remainingActive.find(
    (player: any) =>
      Number(player.fid) === Number(currentGameState.current_turn_fid) &&
      isBotPlayer(player),
  );
  if (!aiPlayer) {
    return false;
  }

  const newTableBet = Number(currentGameState.current_bet || 0);
  const newPotSize = Number(currentGameState.pot_size || 0);
  const aiCurrentBet = Number(aiPlayer.current_bet || 0);
  const aiToCall = newTableBet - aiCurrentBet;
  const aiFid = Number(aiPlayer.fid);
  const aiDecision = evaluateAIAction(
    String(aiPlayer.hand || ""),
    String(currentGameState.board || ""),
    aiToCall,
    newPotSize,
    Number(aiPlayer.stack_size || 0),
    parseActionHistory(currentGameState.action_history),
  );

  await db.execute({
    sql: "UPDATE players SET has_acted = 1, last_seen = CURRENT_TIMESTAMP WHERE fid = ? AND table_id = ?",
    args: [aiFid, tableId],
  });

  if (aiDecision.action === "raise" || aiDecision.action === "bet") {
    const aiTargetBet = Math.max(
      newTableBet,
      Math.min(
        Number(aiPlayer.stack_size || 0) + aiCurrentBet,
        Number(aiDecision.targetBet || newTableBet),
      ),
    );
    const aiBetDiff = Math.max(0, aiTargetBet - aiCurrentBet);

    if (aiBetDiff > 0) {
      await db.execute({
        sql: "UPDATE tables SET pot_size = pot_size + ?, current_bet = ? WHERE id = ?",
        args: [aiBetDiff, aiTargetBet, tableId],
      });
      await db.execute({
        sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = total_invested + ? WHERE fid = ? AND table_id = ?",
        args: [aiBetDiff, aiTargetBet, aiBetDiff, aiFid, tableId],
      });
      await db.execute({
        sql: "UPDATE players SET has_acted = 0 WHERE table_id = ? AND status = 'playing' AND is_bot = 0",
        args: [tableId],
      });
      await db.execute({
        sql: "UPDATE players SET has_acted = 1 WHERE fid = ? AND table_id = ?",
        args: [aiFid, tableId],
      });
      await appendActionHistory(tableId, "ai", aiDecision.action, aiTargetBet);

      const { rows: activeAfterRaise } = await db.execute({
        sql: "SELECT fid FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC",
        args: [tableId],
      });
      const aiCurrentIndex = activeAfterRaise.findIndex((player: any) => Number(player.fid) === aiFid);
      const aiNextIndex = (aiCurrentIndex + 1) % activeAfterRaise.length;
      const aiNextFid = activeAfterRaise[aiNextIndex].fid;
      await db.execute({
        sql: "UPDATE tables SET current_turn_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?",
        args: [aiNextFid, tableId],
      });
    }

    return true;
  }

  if (aiDecision.action === "call" || aiDecision.action === "check" || aiToCall === 0) {
    const callAmount = Math.max(0, aiToCall);
    await db.execute({
      sql: "UPDATE tables SET pot_size = pot_size + ? WHERE id = ?",
      args: [callAmount, tableId],
    });
    await db.execute({
      sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = total_invested + ? WHERE fid = ? AND table_id = ?",
      args: [callAmount, newTableBet, callAmount, aiFid, tableId],
    });
    await appendActionHistory(
      tableId,
      "ai",
      callAmount > 0 ? "call" : "check",
      callAmount > 0 ? callAmount : undefined,
    );

    const { rows: activeAfterAI } = await db.execute({
      sql: "SELECT fid, current_bet, has_acted FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC",
      args: [tableId],
    });
    const aiStreetOver = activeAfterAI.every(
      (player: any) => Number(player.has_acted || 0) === 1 && Number(player.current_bet || 0) === newTableBet,
    );

    if (aiStreetOver) {
      const { rows: freshState } = await db.execute({
        sql: "SELECT * FROM tables WHERE id = ?",
        args: [tableId],
      });
      await advanceGame(tableId, freshState[0]);
    } else {
      const aiCurrentIndex = activeAfterAI.findIndex((player: any) => Number(player.fid) === aiFid);
      const aiNextIndex = (aiCurrentIndex + 1) % activeAfterAI.length;
      const aiNextFid = activeAfterAI[aiNextIndex].fid;
      await db.execute({
        sql: "UPDATE tables SET current_turn_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?",
        args: [aiNextFid, tableId],
      });
    }

    return true;
  }

  await db.execute({
    sql: "UPDATE players SET status = 'folded' WHERE fid = ? AND table_id = ?",
    args: [aiFid, tableId],
  });
  await appendActionHistory(tableId, "ai", "fold");

  const { rows: rem } = await db.execute({
    sql: "SELECT fid, current_bet, has_acted FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC",
    args: [tableId],
  });
  if (rem.length === 1) {
    await db.execute({
      sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?",
      args: [newPotSize, rem[0].fid, tableId],
    });
    await db.execute({
      sql: "UPDATE tables SET phase = 'showdown', pot_size = 0, current_bet = 0 WHERE id = ?",
      args: [tableId],
    });
    await resolveFoldWin(
      tableId,
      Number(rem[0].fid),
      newPotSize,
      String(currentGameState.board || ""),
      String(currentGameState.phase || "preflop"),
    );
    return true;
  }

  const aiStreetOver = rem.every(
    (player: any) => Number(player.has_acted || 0) === 1 && Number(player.current_bet || 0) === newTableBet,
  );
  if (aiStreetOver) {
    const { rows: freshState } = await db.execute({
      sql: "SELECT * FROM tables WHERE id = ?",
      args: [tableId],
    });
    await advanceGame(tableId, freshState[0]);
  } else {
    const oldAiIndex = remainingActive.findIndex((player: any) => Number(player.fid) === aiFid);
    const aiNextIndex = oldAiIndex % rem.length;
    const aiNextFid = rem[aiNextIndex].fid;
    await db.execute({
      sql: "UPDATE tables SET current_turn_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [aiNextFid, tableId],
    });
  }

  return true;
}

async function runAutoplayUntilHuman(tableId: string, maxTurns = AUTOPLAY_MAX_TURNS) {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const acted = await playAutomatedTurn(tableId);
    if (!acted) {
      break;
    }
  }
}

async function getTableSnapshot(tableId: string) {
  const { rows } = await db.execute({
    sql: "SELECT * FROM tables WHERE id = ?",
    args: [tableId],
  });

  const tableState = rows[0];
  if (!tableState) {
    return null;
  }

  const { rows: players } = await db.execute({
    sql: "SELECT fid, username, pfp_url, stack_size, hand, current_bet, status, seat_index, is_ready, is_bot FROM players WHERE table_id = ? ORDER BY seat_index ASC",
    args: [tableId],
  });

  return {
    tableState,
    players,
  };
}

async function buildTableResponse(tableId: string) {
  const snapshot = await getTableSnapshot(tableId);
  if (!snapshot) {
    return null;
  }

  const { tableState, players } = snapshot;
  const { levelIndex, blinds, nextLevelInSecs } = getCurrentBlinds(
    tableState.start_time ? String(tableState.start_time) : null,
  );
  const readyCount = players.filter(
    (player: any) => !isBotPlayer(player) && Number(player.is_ready || 0) === 1,
  ).length;

  return {
    success: true,
    gameState: {
      ...tableState,
      ...getTableMetadata(tableState),
      current_blinds: blinds,
      next_level_in_secs: nextLevelInSecs,
      level_index: levelIndex,
      player_count: players.length,
      ready_count: readyCount,
      normalized_status: getNormalizedLobbyStatus(tableState, players.length),
    },
    players,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tableId = searchParams.get("table_id");
  const currentFidStr = searchParams.get("fid");
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  const finishJson = (body: unknown, init?: ResponseInit) => {
    const elapsed = Date.now() - startTime;
    console.log(`[${requestId}] GET /api/table complete (${elapsed}ms)`);
    return NextResponse.json(body, init);
  };

  try {
    await ensureDb();
    console.log(`[${requestId}] GET /api/table start, tableId=${tableId}, fid=${currentFidStr}`);

    if (tableId) {
      // Get single table state
      const { rows } = await db.execute({
        sql: "SELECT * FROM tables WHERE id = ?",
        args: [tableId]
      });

      let tableState = rows[0];
      if (!tableState) {
        return finishJson(
          { success: false, error: "Table not found" },
          { status: 404 },
        );
      }

      await ensureAutoplayBot(tableId);
      const { rows: refreshedRows } = await db.execute({
        sql: "SELECT * FROM tables WHERE id = ?",
        args: [tableId],
      });
      tableState = refreshedRows[0];

      if (tableState && tableState.status === "waiting") {
        const { rows: waitingPlayers } = await db.execute({
          sql: "SELECT fid, is_bot FROM players WHERE table_id = ? ORDER BY seat_index ASC",
          args: [tableId],
        });
        if (shouldStartAutoplayHand(tableState, waitingPlayers)) {
          await refreshAutoplayStartTime(tableId, waitingPlayers);
          await dealNewHand(
            tableId,
            waitingPlayers.map((player) => Number(player.fid)),
          );
          await runAutoplayUntilHuman(tableId, AUTOPLAY_MAX_TURNS);
          const { rows: updatedRows } = await db.execute({
            sql: "SELECT * FROM tables WHERE id = ?",
            args: [tableId],
          });
          tableState = updatedRows[0];
        }
      }

      if (currentFidStr) {
        await db.execute({
          sql: "UPDATE players SET last_seen = CURRENT_TIMESTAMP WHERE fid = ? AND table_id = ?",
          args: [currentFidStr, tableId]
        });
      }

      // Remove idle human players after 10 minutes. The built-in practice bot
      // does not poll this endpoint and must not be deleted as "inactive".
      await db.execute({
        sql: "DELETE FROM players WHERE table_id = ? AND is_bot = 0 AND (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', last_seen)) > 600",
        args: [tableId]
      });

      await ensureAutoplayBot(tableId);

      // Check for 25s auto-fold / sit-out
      if (tableState && tableState.status === 'playing' && tableState.current_turn_fid && tableState.turn_started_at) {
        const { rows: pRows } = await db.execute({
          sql: "SELECT last_seen, is_bot FROM players WHERE fid = ? AND table_id = ?",
          args: [tableState.current_turn_fid, tableId]
        });
        
        if (pRows.length > 0 && !isBotPlayer(pRows[0])) {
          const { rows: timeRows } = await db.execute({
            sql: "SELECT (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', ?)) as elapsed_turn, (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', ?)) as elapsed_seen",
            args: [tableState.turn_started_at, pRows[0].last_seen]
          });
          
          const elapsedTurn = Number(timeRows[0].elapsed_turn || 0);
          const elapsedSeen = Number(timeRows[0].elapsed_seen || 0);
          if (elapsedTurn > 25 || elapsedSeen > 25) {
            // Auto-fold the player to keep the game moving
            try {
              // We just process the fold directly here to avoid a self-fetch
              const fidToFold = tableState.current_turn_fid;
              const { rows: oldPlayers } = await db.execute({ sql: "SELECT fid FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC", args: [tableId] });
              const currentIndex = oldPlayers.findIndex((p: any) => p.fid === fidToFold);
              
              if (currentIndex !== -1) {
                const nextPlayerIndex = (currentIndex + 1) % oldPlayers.length;
                const nextPlayerFid = oldPlayers[nextPlayerIndex].fid;
                
                await db.execute({ sql: "UPDATE players SET status = 'folded' WHERE fid = ? AND table_id = ?", args: [fidToFold, tableId] });
                
                const { rows: remaining } = await db.execute({ sql: "SELECT fid, current_bet FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC", args: [tableId] });
                if (remaining.length === 1) {
                  await db.execute({ sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?", args: [tableState.pot_size, remaining[0].fid, tableId] });
                  await db.execute({ sql: "UPDATE tables SET phase = 'showdown', pot_size = 0, current_bet = 0 WHERE id = ?", args: [tableId] });
                  await resolveFoldWin(tableId, Number(remaining[0].fid), Number(tableState.pot_size || 0), String(tableState.board || ""), String(tableState.phase || "preflop"));
                } else {
                  let newLastAggressor = tableState.last_aggressor_fid;
                  if (newLastAggressor === fidToFold) newLastAggressor = nextPlayerFid;
                  
                  if (nextPlayerFid === newLastAggressor) {
                     const { rows: freshState } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [tableId]});
                     await advanceGame(tableId, freshState[0]);
                  } else {
                     await db.execute({ sql: "UPDATE tables SET current_turn_fid = ?, last_aggressor_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?", args: [nextPlayerFid, newLastAggressor, tableId] });
                  }
                }
              }
            } catch (e) { console.error(e); }
          }
        }
      }

      await runAutoplayUntilHuman(tableId, AUTOPLAY_MAX_TURNS);

      const response = await buildTableResponse(tableId);
      if (!response) {
        return finishJson(
          { success: false, error: "Table not found" },
          { status: 404 },
        );
      }

      return finishJson(response);
    } else {
      // Lobby Mode - list all tables and player counts
      await ensureDefaultLobbyBots();
      const { rows: tables } = await db.execute("SELECT * FROM tables ORDER BY COALESCE(created_at, updated_at, start_time), id");
      const { rows: players } = await db.execute(
        "SELECT table_id, fid, is_ready, is_bot FROM players ORDER BY table_id, seat_index ASC",
      );

      const playersByTable = players.reduce((acc: Record<string, any[]>, player: any) => {
        const tableId = String(player.table_id);
        if (!acc[tableId]) {
          acc[tableId] = [];
        }
        acc[tableId].push(player);
        return acc;
      }, {});

      const tablesWithCounts = tables.map((table: any) => {
        const tablePlayers = playersByTable[String(table.id)] ?? [];

        return {
          ...table,
          ...getTableMetadata(table),
          player_count: tablePlayers.length,
          ready_count: tablePlayers.filter(
            (player) => !isBotPlayer(player) && Number(player.is_ready || 0) === 1,
          ).length,
          normalized_status: getNormalizedLobbyStatus(table, tablePlayers.length),
          supports_ready_state: true,
          supports_table_creation: true,
        };
      });

      return finishJson({
        success: true,
        tables: tablesWithCounts
      });
    }
  } catch (error) {
    console.error("Database error:", error);
    return finishJson({ success: false, error: "Failed to fetch table state" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();

    const {
      fid: rawFid,
      username,
      pfp_url,
      table_id,
      action,
      amount,
      name,
      game,
      stakes,
      maxPlayers: requestedMaxPlayers,
      buyIn: requestedBuyIn,
    } = await request.json();
    const fid = Number(rawFid);
    const actionAmount = Number(amount || 0);

    if (!action || typeof action !== "string") {
      return NextResponse.json(
        { success: false, error: "A valid table action is required" },
        { status: 400 },
      );
    }

    if (!Number.isSafeInteger(fid)) {
      return NextResponse.json(
        { success: false, error: "A valid Farcaster user is required" },
        { status: 400 },
      );
    }

    let effectiveTableId = typeof table_id === "string" ? table_id : "";
    let requestedTable: any = null;

    if (action === "create") {
      const tableName = typeof name === "string" && name.trim() ? name.trim() : "Custom Table";
      const normalizedGame = typeof game === "string" && game.trim() ? game.trim() : "NLHE";
      const normalizedStakes =
        typeof stakes === "string" && stakes.trim() ? stakes.trim() : "$0.50 / $1";
      const maxPlayers = Math.min(9, Math.max(2, Number(requestedMaxPlayers || 6)));
      const buyIn = Math.max(1, Math.round(Number(requestedBuyIn || 50)));
      effectiveTableId = createCustomTableId(tableName);

      await db.execute({
        sql: `
          INSERT INTO tables (
            id,
            name,
            game_type,
            stakes_label,
            max_players,
            buy_in,
            status,
            start_time,
            created_by_fid,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'waiting', NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        args: [
          effectiveTableId,
          tableName,
          normalizedGame,
          normalizedStakes,
          maxPlayers,
          buyIn,
          fid,
        ],
      });
    } else {
      if (!effectiveTableId) {
        return NextResponse.json(
          { success: false, error: "A valid table is required" },
          { status: 400 },
        );
      }

      const { rows: requestedTables } = await db.execute({
        sql: "SELECT * FROM tables WHERE id = ?",
        args: [effectiveTableId],
      });
      requestedTable = requestedTables[0];
      if (!requestedTable) {
        return NextResponse.json(
          { success: false, error: "Table not found" },
          { status: 404 },
        );
      }
    }

    if (action === "create") {
      // The table row is already inserted above; the unified response builder
      // below returns the hydrated table state.
    } else if (action === "join") {
      await db.execute({
        sql: "DELETE FROM players WHERE table_id = ? AND is_bot = 0 AND (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', last_seen)) > 600",
        args: [effectiveTableId],
      });

      const { rows: existingRows } = await db.execute({
        sql: "SELECT fid, seat_index FROM players WHERE fid = ? AND table_id = ?",
        args: [fid, effectiveTableId],
      });
      const isAlreadySeated = existingRows.length > 0;

      const { rows: currentPlayers } = await db.execute({
        sql: "SELECT fid, seat_index, is_bot FROM players WHERE table_id = ? ORDER BY seat_index ASC",
        args: [effectiveTableId]
      });
      const playerCount = currentPlayers.length;
      const maxPlayers = Number(requestedTable.max_players || 6);

      if (
        effectiveTableId === "room_1" &&
        currentPlayers.some((player) => !isBotPlayer(player) && Number(player.fid) !== fid)
      ) {
        return NextResponse.json(
          { success: false, error: "The practice opponent is already in a match" },
          { status: 409 },
        );
      }

      // Recover abandoned games instead of leaving a table permanently stuck
      // in "playing" after a serverless timeout or disconnect.
      if (requestedTable.status === "playing" && !isAlreadySeated && playerCount < 2) {
        await db.execute({
          sql: "UPDATE tables SET status = 'waiting', pot_size = 0, current_bet = 0, board = '', deck = '', action_history = '', phase = 'preflop', current_turn_fid = NULL, last_aggressor_fid = NULL WHERE id = ?",
          args: [effectiveTableId],
        });
        await db.execute({
          sql: "UPDATE players SET status = 'waiting', hand = '', current_bet = 0, is_ready = 0, has_acted = 0 WHERE table_id = ?",
          args: [effectiveTableId],
        });
      } else if (requestedTable.status === "playing" && !isAlreadySeated) {
        return NextResponse.json(
          { success: false, error: "This table has already started" },
          { status: 409 },
        );
      }

      if (!isAlreadySeated && playerCount >= maxPlayers) {
        return NextResponse.json(
          { success: false, error: "This table is full" },
          { status: 409 },
        );
      }

      const seatIndex = getLowestOpenSeat(currentPlayers, maxPlayers);

      if (isAlreadySeated) {
        await db.execute({
          sql: "UPDATE players SET username = ?, pfp_url = ?, last_seen = CURRENT_TIMESTAMP WHERE fid = ? AND table_id = ?",
          args: [username || `User#${fid}`, pfp_url || "", fid, effectiveTableId],
        });
      } else {
       await db.execute({
         sql: "INSERT OR REPLACE INTO players (fid, username, pfp_url, table_id, seat_index, stack_size, hand, current_bet, status, is_bot, is_ready, has_acted, total_invested, last_seen) VALUES (?, ?, ?, ?, ?, 5000, '', 0, 'waiting', 0, 0, 0, 0, CURRENT_TIMESTAMP)",
         args: [fid, username || `User#${fid}`, pfp_url || "", effectiveTableId, seatIndex]
       });
      }

      await ensureAutoplayBot(effectiveTableId);

      // Get count of players in this room
      const { rows: players } = await db.execute({
       sql: "SELECT fid, is_bot FROM players WHERE table_id = ? ORDER BY seat_index ASC",
       args: [effectiveTableId]
      });
      const seatedFids = players.map((player) => Number(player.fid));

      if (
       shouldStartAutoplayHand(requestedTable, players) ||
       (requestedTable.status === "playing" && playerCount < 2 && seatedFids.length >= 2)
      ) {
       await refreshAutoplayStartTime(effectiveTableId, players);
       await dealNewHand(effectiveTableId, seatedFids);
      }
    } else if (action === "toggle_ready") {
      if (requestedTable.status === "playing") {
       return NextResponse.json(
          { success: false, error: "Ready state can only be changed before a hand starts" },
          { status: 409 },
        );
      }

      const { rows: seatedRows } = await db.execute({
        sql: "SELECT fid, is_ready FROM players WHERE fid = ? AND table_id = ?",
        args: [fid, effectiveTableId],
      });

      if (seatedRows.length === 0) {
        return NextResponse.json(
          { success: false, error: "You must join the table before marking ready" },
          { status: 409 },
        );
      }

      const nextReady = Number(seatedRows[0].is_ready || 0) === 1 ? 0 : 1;
      await db.execute({
        sql: "UPDATE players SET is_ready = ?, last_seen = CURRENT_TIMESTAMP WHERE fid = ? AND table_id = ?",
        args: [nextReady, fid, effectiveTableId],
      });

      await ensureAutoplayBot(effectiveTableId);
      const { rows: players } = await db.execute({
        sql: "SELECT fid, is_ready, is_bot FROM players WHERE table_id = ? ORDER BY seat_index ASC",
        args: [effectiveTableId],
      });
      const humanPlayers = players.filter((player: any) => !isBotPlayer(player));
      const readyHumans = humanPlayers.filter((player: any) => Number(player.is_ready || 0) === 1);

      if (
        players.length >= 2 &&
        humanPlayers.length > 0 &&
        readyHumans.length === humanPlayers.length
      ) {
        await refreshAutoplayStartTime(effectiveTableId, players);
        await dealNewHand(
          effectiveTableId,
          players.map((player: any) => Number(player.fid)),
        );
      }
    } else if (action === "leave") {
      await db.execute({
        sql: "DELETE FROM players WHERE fid = ? AND table_id = ?",
        args: [fid, effectiveTableId],
      });

      const { rows: remainingPlayers } = await db.execute({
        sql: "SELECT fid, status, is_bot FROM players WHERE table_id = ? ORDER BY seat_index ASC",
        args: [effectiveTableId],
      });
      const humanPlayers = remainingPlayers.filter((player: any) => !isBotPlayer(player));

      if (humanPlayers.length === 0) {
        await db.execute({ sql: "DELETE FROM players WHERE table_id = ?", args: [effectiveTableId] });
        await db.execute({
          sql: "UPDATE tables SET status = 'waiting', pot_size = 0, current_bet = 0, board = '', deck = '', action_history = '', phase = 'preflop', current_turn_fid = NULL, last_aggressor_fid = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [effectiveTableId],
        });
      } else if (requestedTable.status === "playing") {
        const activePlayers = remainingPlayers.filter((player: any) => player.status === "playing");
        if (activePlayers.length === 1) {
          await db.execute({
            sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?",
            args: [requestedTable.pot_size || 0, activePlayers[0].fid, effectiveTableId],
          });
          await db.execute({
            sql: "UPDATE tables SET phase = 'showdown', pot_size = 0, current_bet = 0, current_turn_fid = NULL WHERE id = ?",
            args: [effectiveTableId],
          });
          await resolveFoldWin(
            effectiveTableId,
            Number(activePlayers[0].fid),
            Number(requestedTable.pot_size || 0),
            String(requestedTable.board || ""),
            String(requestedTable.phase || "preflop"),
          );
        }
      } else {
        await db.execute({
          sql: "UPDATE tables SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [effectiveTableId],
        });
      }
    } else if (action === "deal") {
      const { rows: players } = await db.execute({
        sql: "SELECT fid FROM players WHERE table_id = ? ORDER BY seat_index ASC",
        args: [effectiveTableId]
      });
      await dealNewHand(effectiveTableId, players.map((p: any) => p.fid));
    } else if (action === "fold") {
      const { rows: stateRows } = await db.execute({ sql: "SELECT current_turn_fid, last_aggressor_fid, pot_size, board, phase FROM tables WHERE id = ?", args: [effectiveTableId] });
      const currentGameState = stateRows[0];
      
      if (currentGameState && currentGameState.current_turn_fid === fid) {
        const { rows: oldPlayers } = await db.execute({ sql: "SELECT fid FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC", args: [effectiveTableId] });
        const currentIndex = oldPlayers.findIndex((p: any) => p.fid === fid);
        const nextPlayerIndex = (currentIndex + 1) % oldPlayers.length;
        const nextPlayerFid = oldPlayers[nextPlayerIndex].fid;
        
        // Update status to folded instead of deleting to keep them at the table
        await db.execute({ sql: "UPDATE players SET status = 'folded' WHERE fid = ? AND table_id = ?", args: [fid, effectiveTableId] });
        await appendActionHistory(effectiveTableId, `p${fid}`, "fold");
        
        const { rows: remaining } = await db.execute({ sql: "SELECT fid, current_bet, has_acted FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC", args: [effectiveTableId] });
        if (remaining.length === 1) {
          // Last player remaining wins pot
          await db.execute({ sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?", args: [currentGameState.pot_size, remaining[0].fid, effectiveTableId] });
          await db.execute({ sql: "UPDATE tables SET phase = 'showdown', pot_size = 0, current_bet = 0 WHERE id = ?", args: [effectiveTableId] });
          await resolveFoldWin(
            effectiveTableId,
            Number(remaining[0].fid),
            Number(currentGameState.pot_size || 0),
            String(currentGameState.board || ""),
            String(currentGameState.phase || "preflop"),
          );
        } else {
          const streetOver = remaining.every((p: any) => p.has_acted === 1 && p.current_bet === currentGameState.current_bet);
          if (streetOver) {
             const { rows: freshState } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [effectiveTableId]});
             await advanceGame(effectiveTableId, freshState[0]);
          } else {
             await db.execute({ sql: "UPDATE tables SET current_turn_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?", args: [nextPlayerFid, effectiveTableId] });
             // We'd trigger AI here, but AI is never human folding, so we just let it be. Wait, if human folds and next is AI? 
             // We don't trigger AI here in the original code either, it expects the client to poll? No, original code didn't trigger AI on fold.
             // Wait, if human folds, the hand either ends (remaining=1) or it passes to the next. In 2-player it always ends.
          }
        }
      }
    } else {
      // Process betting actions: check, call, bet, raise, all_in
      const { rows: stateRows } = await db.execute({
        sql: "SELECT * FROM tables WHERE id = ?",
        args: [table_id]
      });
      const currentGameState = stateRows[0];

      const { rows: playerRows } = await db.execute({
        sql: "SELECT fid, stack_size, hand, current_bet FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC",
        args: [table_id]
      });
      
      const currentPlayer = playerRows.find((r: any) => r.fid === fid);
      
      if (currentPlayer && currentGameState.current_turn_fid === fid) {
        let newPotSize = Number(currentGameState.pot_size || 0);
        let newTableBet = Number(currentGameState.current_bet || 0);
        let newPlayerBet = Number(currentPlayer.current_bet || 0);
        let newPlayerStack = Number(currentPlayer.stack_size || 0);
        let betDiff = 0;

        if (action === "check") {
           // do nothing
        } else if (action === "call") {
           betDiff = newTableBet - newPlayerBet;
        } else if (action === "bet" || action === "raise") {
           betDiff = actionAmount - newPlayerBet;
           newTableBet = actionAmount;
        } else if (action === "all_in") {
           betDiff = newPlayerStack;
           newTableBet = Math.max(newTableBet, newPlayerBet + betDiff);
        }

        if (betDiff > 0) {
           newPlayerBet += betDiff;
           newPlayerStack -= betDiff;
           newPotSize += betDiff;

           await db.execute({
             sql: "UPDATE players SET stack_size = ?, current_bet = ?, total_invested = total_invested + ? WHERE fid = ? AND table_id = ?",
             args: [newPlayerStack, newPlayerBet, betDiff, fid, table_id]
           });
           
           await db.execute({
             sql: "UPDATE tables SET pot_size = ?, current_bet = ? WHERE id = ?",
             args: [newPotSize, newTableBet, table_id]
           });
        }
        
        // Action is valid, set has_acted = 1
        await db.execute({ sql: "UPDATE players SET has_acted = 1 WHERE fid = ? AND table_id = ?", args: [fid, table_id] });
        await appendActionHistory(
          table_id,
          `p${fid}`,
          action,
          action === "bet" || action === "raise" || action === "all_in" || action === "call"
            ? actionAmount || betDiff || undefined
            : undefined,
        );

        const { rows: remainingActive } = await db.execute({ sql: "SELECT fid, current_bet, has_acted, hand FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC", args: [table_id] });
        
        const streetOver = remainingActive.every((p: any) => p.has_acted === 1 && p.current_bet === newTableBet);

        if (streetOver) {
           const { rows: freshState } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [table_id] });
           await advanceGame(table_id, freshState[0]);
        } else {
           let currentIndex = remainingActive.findIndex((r: any) => r.fid === fid);
           let nextPlayerIndex = (currentIndex + 1) % remainingActive.length;
           let nextPlayerFid = remainingActive[nextPlayerIndex].fid;

           await db.execute({ sql: "UPDATE tables SET current_turn_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?", args: [nextPlayerFid, table_id] });
        }
      }
    }

    await ensureAutoplayBot(effectiveTableId);
    await runAutoplayUntilHuman(effectiveTableId, AUTOPLAY_MAX_TURNS);
    const response = await buildTableResponse(effectiveTableId);
    if (!response) {
      return NextResponse.json(
        { success: false, error: "Table not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(response);

  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ success: false, error: "Failed to update table state" }, { status: 500 });
  }
}
