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

  // Preflop
  if (board.length === 0) {
    if (isPair) return "call";
    if (v1 >= 10 && v2 >= 10) return "call";
    if (isSuited && (v1 >= 9 || v2 >= 9)) return "call";
    if (isConnector && (v1 >= 8 || v2 >= 8)) return "call";
    if (toCall > 150) return "fold";
    if (toCall <= 50) return "call";
    return "fold";
  }

  // Postflop
  const allCards = [...aiHand, ...board];
  const allRanks = allCards.map(c => c[0]);
  const allSuits = allCards.map(c => c[1]);
  
  const rankCounts: Record<string, number> = {};
  for (const r of allRanks) {
    rankCounts[r] = (rankCounts[r] || 0) + 1;
  }
  const maxDuplicates = Math.max(...Object.values(rankCounts));
  const hasPair = maxDuplicates >= 2;
  
  const suitCounts: Record<string, number> = {};
  for (const s of allSuits) {
    suitCounts[s] = (suitCounts[s] || 0) + 1;
  }
  const maxSuits = Math.max(...Object.values(suitCounts));
  const hasFlushDraw = maxSuits >= 4;

  if (hasPair || hasFlushDraw) return "call";
  if (toCall === 0) return "call";
  if (Math.random() < 0.1) return "call";
  return "fold";
}

// Deal a new hand (Preflop)
async function dealNewHand(tableId: string, fids: number[]) {
  const deck = createDeck();
  
  // Deal 2 cards to each player
  for (const fid of fids) {
    const c1 = deck.pop();
    const c2 = deck.pop();
    const hand = `${c1},${c2}`;
    
    // User or AI posts blind
    const blindAmount = fid === 1 ? 25 : 50; // AI is SB, User is BB
    await db.execute({
      sql: "UPDATE players SET hand = ?, current_bet = ?, stack_size = stack_size - ? WHERE fid = ?",
      args: [hand, blindAmount, blindAmount, fid]
    });
  }

  const deckStr = deck.join(",");
  
  // Initialize pot (75)
  await db.execute({
    sql: "UPDATE tables SET pot_size = 75, current_bet = 50, board = '', deck = ?, phase = 'preflop', status = 'playing' WHERE id = ?",
    args: [deckStr, tableId]
  });
}

// Advance game to next street
async function advanceGame(tableId: string, currentState: any) {
  const phase = currentState.phase;
  const boardStr = currentState.board;
  const deckStr = currentState.deck;
  
  const deck = deckStr ? deckStr.split(",") : [];
  const board = boardStr ? boardStr.split(",") : [];

  // Reset betting for the next street
  await db.execute({
    sql: "UPDATE players SET current_bet = 0 WHERE table_id = ?",
    args: [tableId]
  });

  if (phase === "preflop") {
    // Deal Flop (3 cards)
    const c1 = deck.pop();
    const c2 = deck.pop();
    const c3 = deck.pop();
    if (c1 && c2 && c3) board.push(c1, c2, c3);
    await db.execute({
      sql: "UPDATE tables SET board = ?, deck = ?, phase = 'flop', current_bet = 0 WHERE id = ?",
      args: [board.join(","), deck.join(","), tableId]
    });
  } else if (phase === "flop") {
    // Deal Turn (1 card)
    const c = deck.pop();
    if (c) board.push(c);
    await db.execute({
      sql: "UPDATE tables SET board = ?, deck = ?, phase = 'turn', current_bet = 0 WHERE id = ?",
      args: [board.join(","), deck.join(","), tableId]
    });
  } else if (phase === "turn") {
    // Deal River (1 card)
    const c = deck.pop();
    if (c) board.push(c);
    await db.execute({
      sql: "UPDATE tables SET board = ?, deck = ?, phase = 'river', current_bet = 0 WHERE id = ?",
      args: [board.join(","), deck.join(","), tableId]
    });
  } else if (phase === "river") {
    // Showdown phase
    await db.execute({
      sql: "UPDATE tables SET phase = 'showdown', current_bet = 0 WHERE id = ?",
      args: [tableId]
    });
  }
}

export async function GET(request: Request) {
  try {
    if (!initialized) {
      await initDb();
      initialized = true;
    }

    const { searchParams } = new URL(request.url);
    const tableId = searchParams.get("table_id");

    if (tableId) {
      // Get single table state
      const { rows } = await db.execute({
        sql: "SELECT * FROM tables WHERE id = ?",
        args: [tableId]
      });
      const { rows: players } = await db.execute({
        sql: "SELECT fid, username, pfp_url, stack_size, hand, current_bet, status FROM players WHERE table_id = ?",
        args: [tableId]
      });

      return NextResponse.json({
        success: true,
        gameState: rows[0],
        players: players
      });
    } else {
      // Lobby Mode - list all tables and player counts
      const { rows: tables } = await db.execute("SELECT * FROM tables");
      const { rows: playersCounts } = await db.execute("SELECT table_id, COUNT(*) as count FROM players GROUP BY table_id");

      const countsMap = playersCounts.reduce((acc: any, r: any) => {
        acc[r.table_id] = r.count;
        return acc;
      }, {});

      const tablesWithCounts = tables.map((t: any) => ({
        ...t,
        player_count: countsMap[t.id] || 0
      }));

      return NextResponse.json({
        success: true,
        tables: tablesWithCounts
      });
    }
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

    const { fid, username, pfp_url, table_id, action, amount } = await request.json();
    
    if (action === "join") {
      // Add Player (User)
      await db.execute({
        sql: "INSERT OR REPLACE INTO players (fid, username, pfp_url, table_id, stack_size, hand, current_bet, status) VALUES (?, ?, ?, ?, 5000, '', 0, 'waiting')",
        args: [fid, username || `User#${fid}`, pfp_url || "", table_id]
      });

      // Add Simulated AI opponent to make the game playable right away in the waiting room
      await db.execute({
        sql: "INSERT OR REPLACE INTO players (fid, username, pfp_url, table_id, stack_size, hand, current_bet, status) VALUES (1, 'PokerCoachJohnny', 'https://i.imgur.com/k2j4j3V.jpeg', ?, 5000, '', 0, 'waiting')",
        args: [table_id]
      });

      // Get count of players in this room
      const { rows: players } = await db.execute({
        sql: "SELECT fid FROM players WHERE table_id = ?",
        args: [table_id]
      });
      const seatedFids = players.map((p: any) => p.fid);

      const { rows: tableRows } = await db.execute({
        sql: "SELECT max_players FROM tables WHERE id = ?",
        args: [table_id]
      });
      const maxPlayers = tableRows[0]?.max_players || 6;

      // Start the hand if enough players (since we have the user + simulated AI, count is 2)
      if (seatedFids.length >= 2) {
        await dealNewHand(table_id, seatedFids);
      }
    } else if (action === "deal") {
      const { rows: players } = await db.execute({
        sql: "SELECT fid FROM players WHERE table_id = ?",
        args: [table_id]
      });
      await dealNewHand(table_id, players.map((p: any) => p.fid));
    } else if (action === "fold") {
      await db.execute({
        sql: "DELETE FROM players WHERE fid = ? AND table_id = ?",
        args: [fid, table_id]
      });
      
      const { rows: players } = await db.execute({
        sql: "SELECT fid FROM players WHERE table_id = ?",
        args: [table_id]
      });
      const remainingFids = players.map((p: any) => p.fid).filter(id => id !== 1); // filter out only AI if user left

      if (remainingFids.length > 0) {
        await dealNewHand(table_id, players.map((p: any) => p.fid));
      } else {
        // Clear AI too and reset room
        await db.execute({ sql: "DELETE FROM players WHERE table_id = ?", args: [table_id] });
        await db.execute({
          sql: "UPDATE tables SET pot_size = 0, current_bet = 0, board = '', deck = '', phase = 'preflop', status = 'waiting' WHERE id = ?",
          args: [table_id]
        });
      }
    } else {
      // Process betting actions: check, call, bet, raise, all_in
      const { rows: stateRows } = await db.execute({
        sql: "SELECT * FROM tables WHERE id = ?",
        args: [table_id]
      });
      const currentGameState = stateRows[0];

      const { rows: playerRows } = await db.execute({
        sql: "SELECT fid, stack_size, hand, current_bet FROM players WHERE table_id = ?",
        args: [table_id]
      });
      
      const currentPlayer = playerRows.find((r: any) => r.fid === fid);
      const aiPlayer = playerRows.find((r: any) => r.fid === 1);

      if (currentPlayer && aiPlayer) {
        if (action === "check") {
          if (currentGameState.current_bet === currentPlayer.current_bet) {
            await advanceGame(table_id, currentGameState);
          }
        } else if (action === "call") {
          const callAmount = currentGameState.current_bet - currentPlayer.current_bet;
          if (callAmount > 0) {
            await db.execute({
              sql: "UPDATE tables SET pot_size = pot_size + ? WHERE id = ?",
              args: [callAmount, table_id]
            });
            await db.execute({
              sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ? WHERE fid = ? AND table_id = ?",
              args: [callAmount, currentGameState.current_bet, fid, table_id]
            });
          }
          
          const { rows: freshState } = await db.execute({
            sql: "SELECT * FROM tables WHERE id = ?",
            args: [table_id]
          });
          await advanceGame(table_id, freshState[0]);
        } else if (action === "bet" || action === "raise") {
          const betDiff = amount - currentPlayer.current_bet;
          
          await db.execute({
            sql: "UPDATE tables SET pot_size = pot_size + ?, current_bet = ? WHERE id = ?",
            args: [betDiff, amount, table_id]
          });
          await db.execute({
            sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ? WHERE fid = ? AND table_id = ?",
            args: [betDiff, amount, fid, table_id]
          });

          // Simulate AI Opponent Call/Fold GTO choice
          const aiToCall = amount - aiPlayer.current_bet;
          const aiDecision = evaluateAIAction(aiPlayer.hand, currentGameState.board, aiToCall);

          if (aiDecision === "call") {
            await db.execute({
              sql: "UPDATE tables SET pot_size = pot_size + ? WHERE id = ?",
              args: [aiToCall, table_id]
            });
            await db.execute({
              sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ? WHERE fid = 1 AND table_id = ?",
              args: [aiToCall, amount, table_id]
            });
            
            const { rows: freshState } = await db.execute({
              sql: "SELECT * FROM tables WHERE id = ?",
              args: [table_id]
            });
            await advanceGame(table_id, freshState[0]);
          } else {
            // AI Folds
            await db.execute({
              sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?",
              args: [currentGameState.pot_size + betDiff, fid, table_id]
            });
            await db.execute({
              sql: "UPDATE tables SET phase = 'showdown', pot_size = 0, current_bet = 0 WHERE id = ?",
              args: [table_id]
            });
          }
        } else if (action === "all_in") {
          const allInAmount = currentPlayer.stack_size;
          const totalPlayerBet = currentPlayer.current_bet + allInAmount;
          
          await db.execute({
            sql: "UPDATE tables SET pot_size = pot_size + ?, current_bet = ? WHERE id = ?",
            args: [allInAmount, totalPlayerBet, table_id]
          });
          await db.execute({
            sql: "UPDATE players SET stack_size = 0, current_bet = ? WHERE fid = ? AND table_id = ?",
            args: [totalPlayerBet, fid, table_id]
          });

          // Simulate AI Call/Fold GTO choice
          const aiToCall = totalPlayerBet - aiPlayer.current_bet;
          const aiDecision = evaluateAIAction(aiPlayer.hand, currentGameState.board, aiToCall);

          if (aiDecision === "call") {
            await db.execute({
              sql: "UPDATE tables SET pot_size = pot_size + ? WHERE id = ?",
              args: [aiToCall, table_id]
            });
            await db.execute({
              sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ? WHERE fid = 1 AND table_id = ?",
              args: [aiToCall, totalPlayerBet, table_id]
            });
            
            const { rows: freshState } = await db.execute({
              sql: "SELECT * FROM tables WHERE id = ?",
              args: [table_id]
            });
            await advanceGame(table_id, freshState[0]);
          } else {
            // AI Folds all-in
            await db.execute({
              sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?",
              args: [currentGameState.pot_size + allInAmount, fid, table_id]
            });
            await db.execute({
              sql: "UPDATE tables SET phase = 'showdown', pot_size = 0, current_bet = 0 WHERE id = ?",
              args: [table_id]
            });
          }
        }
      }
    }

    // Return the updated state
    const { rows } = await db.execute({
      sql: "SELECT * FROM tables WHERE id = ?",
      args: [table_id]
    });
    const { rows: players } = await db.execute({
      sql: "SELECT fid, username, pfp_url, stack_size, hand, current_bet, status FROM players WHERE table_id = ?",
      args: [table_id]
    });

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
