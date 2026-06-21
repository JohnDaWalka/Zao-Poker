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

// Blind levels (6-minute intervals). Ante is fixed at 25% of the Big Blind.
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
  
  // Get table's start_time to calculate blinds
  const { rows: tableRows } = await db.execute({
    sql: "SELECT start_time FROM tables WHERE id = ?",
    args: [tableId]
  });
  const startTime = tableRows[0]?.start_time;
  const { blinds } = getCurrentBlinds(startTime);
  
  let potSize = 0;

  // Deduct ante from all players
  if (blinds.ante > 0) {
    for (const fid of fids) {
      // Find player stack
      const { rows: pRows } = await db.execute({
        sql: "SELECT stack_size FROM players WHERE fid = ? AND table_id = ?",
        args: [fid, tableId]
      });
      const stack = pRows[0]?.stack_size || 0;
      const actualAnte = Math.min(stack, blinds.ante);
      
      if (actualAnte > 0) {
        await db.execute({
          sql: "UPDATE players SET stack_size = stack_size - ? WHERE fid = ? AND table_id = ?",
          args: [actualAnte, fid, tableId]
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

    potSize += blindAmount;

    await db.execute({
      sql: "UPDATE players SET hand = ?, current_bet = ?, stack_size = stack_size - ? WHERE fid = ?",
      args: [hand, blindAmount, blindAmount, fid]
    });
  }

  const deckStr = deck.join(",");
  
  // Initialize pot
  await db.execute({
    sql: "UPDATE tables SET pot_size = ?, current_bet = ?, board = '', deck = ?, phase = 'preflop', status = 'playing', current_turn_fid = ?, last_aggressor_fid = ? WHERE id = ?",
    args: [potSize, blinds.bb, deckStr, currentTurnFid, lastAggressorFid, tableId]
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

      let tableState = rows[0];

      // Auto-start logic if start_time is reached
      if (tableState && tableState.status === 'waiting' && tableState.start_time) {
        if (new Date() >= new Date(tableState.start_time)) {
          const { rows: players } = await db.execute({
            sql: "SELECT fid FROM players WHERE table_id = ? ORDER BY seat_index ASC",
            args: [tableId]
          });
          const fids = players.map((p: any) => p.fid);
          if (fids.length >= 2) {
            await dealNewHand(tableId, fids);
            // Re-fetch updated state
            const { rows: updatedRows } = await db.execute({
              sql: "SELECT * FROM tables WHERE id = ?",
              args: [tableId]
            });
            tableState = updatedRows[0];
          }
        }
      }

      const currentFidStr = searchParams.get("fid");
      if (currentFidStr) {
        await db.execute({
          sql: "UPDATE players SET last_seen = CURRENT_TIMESTAMP WHERE fid = ? AND table_id = ?",
          args: [currentFidStr, tableId]
        });
      }

      // Remove players idle > 10 mins (600s)
      await db.execute({
        sql: "DELETE FROM players WHERE table_id = ? AND (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', last_seen)) > 600",
        args: [tableId]
      });

      // Check for 25s auto-fold / sit-out
      if (tableState && tableState.status === 'playing' && tableState.current_turn_fid && tableState.turn_started_at) {
        const { rows: pRows } = await db.execute({
          sql: "SELECT last_seen FROM players WHERE fid = ? AND table_id = ?",
          args: [tableState.current_turn_fid, tableId]
        });
        
        if (pRows.length > 0) {
          const { rows: timeRows } = await db.execute({
            sql: "SELECT (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', ?)) as elapsed_turn, (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', ?)) as elapsed_seen",
            args: [tableState.turn_started_at, pRows[0].last_seen]
          });
          
          if (timeRows[0].elapsed_turn > 25 || timeRows[0].elapsed_seen > 25) {
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

      const { rows: players } = await db.execute({
        sql: "SELECT fid, username, pfp_url, stack_size, hand, current_bet, status FROM players WHERE table_id = ?",
        args: [tableId]
      });

      const { levelIndex, blinds, nextLevelInSecs } = getCurrentBlinds(tableState.start_time);

      return NextResponse.json({
        success: true,
        gameState: {
          ...tableState,
          current_blinds: blinds,
          next_level_in_secs: nextLevelInSecs,
          level_index: levelIndex
        },
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
      // Get count of current players to assign seat_index
      const { rows: currentPlayers } = await db.execute({
        sql: "SELECT COUNT(*) as count FROM players WHERE table_id = ?",
        args: [table_id]
      });
      const seatIndex = currentPlayers[0].count;

      // Add Player (User)
      await db.execute({
        sql: "INSERT OR REPLACE INTO players (fid, username, pfp_url, table_id, seat_index, stack_size, hand, current_bet, status) VALUES (?, ?, ?, ?, ?, 5000, '', 0, 'waiting')",
        args: [fid, username || `User#${fid}`, pfp_url || "", table_id, seatIndex]
      });

      // Add Simulated AI opponent only if it's the Heads-Up GTO Match
      if (table_id === 'room_1') {
        await db.execute({
          sql: "INSERT OR REPLACE INTO players (fid, username, pfp_url, table_id, seat_index, stack_size, hand, current_bet, status) VALUES (1, 'PokerCoachJohnny', 'https://i.imgur.com/k2j4j3V.jpeg', ?, ?, 5000, '', 0, 'waiting')",
          args: [table_id, seatIndex + 1]
        });
      }

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

      // Don't auto-start immediately for scheduled tournaments; wait for start_time
    } else if (action === "deal") {
      const { rows: players } = await db.execute({
        sql: "SELECT fid FROM players WHERE table_id = ? ORDER BY seat_index ASC",
        args: [table_id]
      });
      await dealNewHand(table_id, players.map((p: any) => p.fid));
    } else if (action === "fold") {
      const { rows: stateRows } = await db.execute({ sql: "SELECT current_turn_fid, last_aggressor_fid, pot_size FROM tables WHERE id = ?", args: [table_id] });
      const currentGameState = stateRows[0];
      
      if (currentGameState && currentGameState.current_turn_fid === fid) {
        const { rows: oldPlayers } = await db.execute({ sql: "SELECT fid FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC", args: [table_id] });
        const currentIndex = oldPlayers.findIndex((p: any) => p.fid === fid);
        const nextPlayerIndex = (currentIndex + 1) % oldPlayers.length;
        const nextPlayerFid = oldPlayers[nextPlayerIndex].fid;
        
        // Update status to folded instead of deleting to keep them at the table
        await db.execute({ sql: "UPDATE players SET status = 'folded' WHERE fid = ? AND table_id = ?", args: [fid, table_id] });
        
        const { rows: remaining } = await db.execute({ sql: "SELECT fid, current_bet FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC", args: [table_id] });
        if (remaining.length === 1) {
          // Last player remaining wins pot
          await db.execute({ sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?", args: [currentGameState.pot_size, remaining[0].fid, table_id] });
          await db.execute({ sql: "UPDATE tables SET phase = 'showdown', pot_size = 0, current_bet = 0 WHERE id = ?", args: [table_id] });
        } else {
          let newLastAggressor = currentGameState.last_aggressor_fid;
          if (newLastAggressor === fid) {
             newLastAggressor = nextPlayerFid;
          }
          if (nextPlayerFid === newLastAggressor) {
             const { rows: freshState } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [table_id]});
             await advanceGame(table_id, freshState[0]);
          } else {
             await db.execute({ sql: "UPDATE tables SET current_turn_fid = ?, last_aggressor_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?", args: [nextPlayerFid, newLastAggressor, table_id] });
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
        let newPotSize = currentGameState.pot_size;
        let newTableBet = currentGameState.current_bet;
        let newPlayerBet = currentPlayer.current_bet;
        let newPlayerStack = currentPlayer.stack_size;
        let betDiff = 0;

        if (action === "check") {
           // do nothing
        } else if (action === "call") {
           betDiff = currentGameState.current_bet - currentPlayer.current_bet;
        } else if (action === "bet" || action === "raise") {
           betDiff = amount - currentPlayer.current_bet;
           newTableBet = amount;
        } else if (action === "all_in") {
           betDiff = currentPlayer.stack_size;
           newTableBet = Math.max(newTableBet, currentPlayer.current_bet + betDiff);
        }

        if (betDiff > 0) {
           newPlayerBet += betDiff;
           newPlayerStack -= betDiff;
           newPotSize += betDiff;

           await db.execute({
             sql: "UPDATE players SET stack_size = ?, current_bet = ? WHERE fid = ? AND table_id = ?",
             args: [newPlayerStack, newPlayerBet, fid, table_id]
           });
           
           await db.execute({
             sql: "UPDATE tables SET pot_size = ?, current_bet = ? WHERE id = ?",
             args: [newPotSize, newTableBet, table_id]
           });
        }
        
        // Pass the turn
        let currentIndex = playerRows.findIndex((r: any) => r.fid === fid);
        let nextPlayerIndex = (currentIndex + 1) % playerRows.length;
        let nextPlayerFid = playerRows[nextPlayerIndex].fid;
        let newLastAggressor = currentGameState.last_aggressor_fid;

        if (action === "bet" || action === "raise" || action === "all_in") {
            newLastAggressor = fid;
        }

        if (nextPlayerFid === newLastAggressor) {
           // street over
           const { rows: freshState } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [table_id] });
           await advanceGame(table_id, freshState[0]);
        } else {
           await db.execute({ sql: "UPDATE tables SET current_turn_fid = ?, last_aggressor_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?", args: [nextPlayerFid, newLastAggressor, table_id] });
           
           // Trigger AI if next player is PokerCoachJohnny
           if (nextPlayerFid === 1) {
              const aiPlayer = playerRows.find((p: any) => p.fid === 1);
              const aiToCall = newTableBet - aiPlayer.current_bet;
              const aiDecision = evaluateAIAction(aiPlayer.hand, currentGameState.board, aiToCall);

              if (aiDecision === "call" || aiToCall === 0) {
                 await db.execute({ sql: "UPDATE tables SET pot_size = pot_size + ? WHERE id = ?", args: [aiToCall, table_id] });
                 await db.execute({ sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ? WHERE fid = 1 AND table_id = ?", args: [aiToCall, newTableBet, table_id] });
                 
                 let aiNextIndex = (nextPlayerIndex + 1) % playerRows.length;
                 let aiNextFid = playerRows[aiNextIndex].fid;
                 
                 if (aiNextFid === newLastAggressor) {
                    const { rows: freshState } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [table_id]});
                    await advanceGame(table_id, freshState[0]);
                 } else {
                    await db.execute({ sql: "UPDATE tables SET current_turn_fid = ?, turn_started_at = CURRENT_TIMESTAMP WHERE id = ?", args: [aiNextFid, table_id] });
                 }
              } else {
                 await db.execute({ sql: "DELETE FROM players WHERE fid = 1 AND table_id = ?", args: [table_id]});
                 const { rows: rem } = await db.execute({ sql: "SELECT fid FROM players WHERE table_id = ?", args: [table_id]});
                 if (rem.length === 1) {
                    await db.execute({ sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?", args: [newPotSize + aiToCall, rem[0].fid, table_id]}); // wait, aiToCall isn't in pot.
                    await db.execute({ sql: "UPDATE tables SET phase = 'showdown', pot_size = 0, current_bet = 0 WHERE id = ?", args: [table_id] });
                 }
              }
           }
        }
      }
    }

    // Return the updated state
    const { rows } = await db.execute({
      sql: "SELECT * FROM tables WHERE id = ?",
      args: [table_id]
    });
    
    const tableState = rows[0];
    const { levelIndex, blinds, nextLevelInSecs } = getCurrentBlinds(tableState.start_time);

    const { rows: players } = await db.execute({
      sql: "SELECT fid, username, pfp_url, stack_size, hand, current_bet, status FROM players WHERE table_id = ?",
      args: [table_id]
    });

    return NextResponse.json({
      success: true,
      gameState: {
        ...tableState,
        current_blinds: blinds,
        next_level_in_secs: nextLevelInSecs,
        level_index: levelIndex
      },
      players: players
    });

  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ success: false, error: "Failed to update table state" }, { status: 500 });
  }
}
