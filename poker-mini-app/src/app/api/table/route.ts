import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

let initialized = false;

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

// Convert card rank character to value
function rankToValue(rank: string): number {
  if (rank === "T") return 10;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  if (rank === "A") return 14;
  return parseInt(rank) || 0;
}

// Heuristic game-tree evaluator to simulate AI opponent's choices (call/fold)
function evaluateAIAction(aiHandStr: string, boardStr: string, toCall: number): "call" | "fold" {
  if (!aiHandStr) return "fold";
  const aiHand = aiHandStr.split(",");
  if (aiHand.length < 2) return "fold";

  const board = boardStr ? boardStr.split(",") : [];

  const ranks = aiHand.map(c => c[0]);
  const suits = aiHand.map(c => c[1]);
  
  const v1 = rankToValue(ranks[0]);
  const v2 = rankToValue(ranks[1]);
  const isPair = v1 === v2;
  const isSuited = suits[0] === suits[1];
  const gap = Math.abs(v1 - v2);
  const isConnector = gap === 1 || gap === 2;

  // 1. Preflop logic
  if (board.length === 0) {
    if (isPair) return "call";
    if (v1 >= 10 && v2 >= 10) return "call";
    if (isSuited && (v1 >= 9 || v2 >= 9)) return "call";
    if (isConnector && (v1 >= 8 || v2 >= 8)) return "call";
    
    // Fold if bet is too high relative to starting hand
    if (toCall > 150) return "fold";
    if (toCall <= 50) return "call"; // Always defend big/small blinds
    return "fold";
  }

  // 2. Postflop logic
  const allCards = [...aiHand, ...board];
  const allRanks = allCards.map(c => c[0]);
  const allSuits = allCards.map(c => c[1]);
  
  // Count rank duplicates (Pairs, Trips, Quads)
  const rankCounts: Record<string, number> = {};
  for (const r of allRanks) {
    rankCounts[r] = (rankCounts[r] || 0) + 1;
  }
  const maxDuplicates = Math.max(...Object.values(rankCounts));
  const hasPair = maxDuplicates >= 2;
  
  // Count suits (Flush Draws)
  const suitCounts: Record<string, number> = {};
  for (const s of allSuits) {
    suitCounts[s] = (suitCounts[s] || 0) + 1;
  }
  const maxSuits = Math.max(...Object.values(suitCounts));
  const hasFlushDraw = maxSuits >= 4;

  if (hasPair || hasFlushDraw) {
    return "call";
  }

  // If there is nothing to call (checked), AI checks/calls
  if (toCall === 0) return "call";

  // 10% bluff-catch/sticky floating call
  if (Math.random() < 0.1) return "call";

  return "fold";
}

// Deal a new hand (Preflop)
async function dealNewHand(fids: number[]) {
  const deck = createDeck();
  
  // Deal 2 cards to each player
  for (const fid of fids) {
    const c1 = deck.pop();
    const c2 = deck.pop();
    const hand = `${c1},${c2}`;
    
    // User is the Big Blind (posts 50)
    if (fid !== 1) {
      await db.execute({
        sql: "UPDATE players SET hand = ?, current_bet = 50, stack_size = stack_size - 50 WHERE fid = ?",
        args: [hand, fid]
      });
    } else {
      // AI is Small Blind (posts 25)
      await db.execute({
        sql: "UPDATE players SET hand = ?, current_bet = 25, stack_size = stack_size - 25 WHERE fid = 1",
        args: [hand]
      });
    }
  }

  const deckStr = deck.join(",");
  
  // Initialize pot with 75 (Small Blind 25 + Big Blind 50) and current active bet to 50
  await db.execute({
    sql: "UPDATE game_state SET pot_size = 75, current_bet = 50, board = '', deck = ?, phase = 'preflop' WHERE id = 'main_table'",
    args: [deckStr]
  });
}

// Advance game to next street
async function advanceGame(currentState: any) {
  const phase = currentState.phase;
  const boardStr = currentState.board;
  const deckStr = currentState.deck;
  
  const deck = deckStr ? deckStr.split(",") : [];
  const board = boardStr ? boardStr.split(",") : [];

  // Reset betting for the next street
  await db.execute("UPDATE players SET current_bet = 0");

  if (phase === "preflop") {
    // Deal Flop (3 cards)
    const c1 = deck.pop();
    const c2 = deck.pop();
    const c3 = deck.pop();
    if (c1 && c2 && c3) board.push(c1, c2, c3);
    await db.execute({
      sql: "UPDATE game_state SET board = ?, deck = ?, phase = 'flop', current_bet = 0 WHERE id = 'main_table'",
      args: [board.join(","), deck.join(",")]
    });
  } else if (phase === "flop") {
    // Deal Turn (1 card)
    const c = deck.pop();
    if (c) board.push(c);
    await db.execute({
      sql: "UPDATE game_state SET board = ?, deck = ?, phase = 'turn', current_bet = 0 WHERE id = 'main_table'",
      args: [board.join(","), deck.join(",")]
    });
  } else if (phase === "turn") {
    // Deal River (1 card)
    const c = deck.pop();
    if (c) board.push(c);
    await db.execute({
      sql: "UPDATE game_state SET board = ?, deck = ?, phase = 'river', current_bet = 0 WHERE id = 'main_table'",
      args: [board.join(","), deck.join(",")]
    });
  } else if (phase === "river") {
    // Showdown phase
    await db.execute({
      sql: "UPDATE game_state SET phase = 'showdown', current_bet = 0 WHERE id = 'main_table'",
      args: []
    });
  }
}

export async function GET() {
  try {
    if (!initialized) {
      await initDb();
      initialized = true;
    }

    const { rows } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
    const { rows: players } = await db.execute("SELECT fid, stack_size, hand, current_bet FROM players");

    return NextResponse.json({
      success: true,
      gameState: rows[0],
      players: players
    });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch table state" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!initialized) {
      await initDb();
      initialized = true;
    }

    const { fid, action, amount } = await request.json();
    
    // Fetch current state
    const { rows: stateRows } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
    const currentGameState = stateRows[0];

    const { rows: playerRows } = await db.execute("SELECT fid, stack_size, hand, current_bet FROM players");
    const activeFids = playerRows.map((r: any) => r.fid);
    
    const currentPlayer = playerRows.find((r: any) => r.fid === fid);
    const aiPlayer = playerRows.find((r: any) => r.fid === 1);

    if (action === "join") {
      // Add Player (User)
      await db.execute({
        sql: "INSERT OR IGNORE INTO players (fid, stack_size, hand, current_bet) VALUES (?, 5000, '', 0)",
        args: [fid]
      });
      // Add AI Opponent
      await db.execute({
        sql: "INSERT OR IGNORE INTO players (fid, stack_size, hand, current_bet) VALUES (1, 5000, '', 0)",
        args: []
      });
      
      await dealNewHand([fid, 1]);
    } else if (action === "deal" || currentGameState.phase === "showdown") {
      await dealNewHand(activeFids.length > 0 ? activeFids : [fid, 1]);
    } else if (action === "fold") {
      // If user folds, reset
      await dealNewHand(activeFids);
    } else if (currentPlayer && aiPlayer) {
      if (action === "check") {
        if (currentGameState.current_bet === currentPlayer.current_bet) {
          await advanceGame(currentGameState);
        }
      } else if (action === "call") {
        const callAmount = currentGameState.current_bet - currentPlayer.current_bet;
        if (callAmount > 0) {
          await db.execute({
            sql: "UPDATE game_state SET pot_size = pot_size + ? WHERE id = 'main_table'",
            args: [callAmount]
          });
          await db.execute({
            sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ? WHERE fid = ?",
            args: [callAmount, currentGameState.current_bet, fid]
          });
        }
        
        const { rows: freshState } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
        await advanceGame(freshState[0]);
      } else if (action === "bet" || action === "raise") {
        const betDiff = amount - currentPlayer.current_bet;
        
        // Deduct player raise
        await db.execute({
          sql: "UPDATE game_state SET pot_size = pot_size + ?, current_bet = ? WHERE id = 'main_table'",
          args: [betDiff, amount]
        });
        await db.execute({
          sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ? WHERE fid = ?",
          args: [betDiff, amount, fid]
        });

        // Run game-tree decision logic for AI calling/folding
        const aiToCall = amount - aiPlayer.current_bet;
        const aiDecision = evaluateAIAction(aiPlayer.hand, currentGameState.board, aiToCall);

        if (aiDecision === "call") {
          // AI Calls
          await db.execute({
            sql: "UPDATE game_state SET pot_size = pot_size + ? WHERE id = 'main_table'",
            args: [aiToCall]
          });
          await db.execute({
            sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ? WHERE fid = 1",
            args: [aiToCall, amount]
          });
          
          const { rows: freshState } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
          await advanceGame(freshState[0]);
        } else {
          // AI Folds! Player wins the pot.
          await db.execute({
            sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ?",
            args: [currentGameState.pot_size + betDiff, fid]
          });
          await db.execute({
            sql: "UPDATE game_state SET phase = 'showdown', pot_size = 0, current_bet = 0 WHERE id = 'main_table'"
          });
        }
      } else if (action === "all_in") {
        const allInAmount = currentPlayer.stack_size;
        const totalPlayerBet = currentPlayer.current_bet + allInAmount;
        
        await db.execute({
          sql: "UPDATE game_state SET pot_size = pot_size + ?, current_bet = ? WHERE id = 'main_table'",
          args: [allInAmount, totalPlayerBet]
        });
        await db.execute({
          sql: "UPDATE players SET stack_size = 0, current_bet = ? WHERE fid = ?",
          args: [totalPlayerBet, fid]
        });

        // Run game-tree decision logic for AI calling/folding all-in
        const aiToCall = totalPlayerBet - aiPlayer.current_bet;
        const aiDecision = evaluateAIAction(aiPlayer.hand, currentGameState.board, aiToCall);

        if (aiDecision === "call") {
          await db.execute({
            sql: "UPDATE game_state SET pot_size = pot_size + ? WHERE id = 'main_table'",
            args: [aiToCall]
          });
          await db.execute({
            sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ? WHERE fid = 1",
            args: [aiToCall, totalPlayerBet]
          });
          
          const { rows: freshState } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
          await advanceGame(freshState[0]);
        } else {
          // AI Folds all-in
          await db.execute({
            sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ?",
            args: [currentGameState.pot_size + allInAmount, fid]
          });
          await db.execute({
            sql: "UPDATE game_state SET phase = 'showdown', pot_size = 0, current_bet = 0 WHERE id = 'main_table'"
          });
        }
      }
    }

    // Return the updated state
    const { rows } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
    const { rows: players } = await db.execute("SELECT fid, stack_size, hand, current_bet FROM players");

    return NextResponse.json({
      success: true,
      gameState: rows[0],
      players: players
    });

  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ success: false, error: "Failed to update table state" }, { status: 500 });
  }
}
