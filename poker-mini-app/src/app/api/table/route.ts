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

// Deal a new hand (Preflop)
async function dealNewHand(fids: number[]) {
  const deck = createDeck();
  
  // Deal 2 cards to each player
  for (const fid of fids) {
    const c1 = deck.pop();
    const c2 = deck.pop();
    const hand = `${c1},${c2}`;
    
    // User is the Big Blind (posts 50)
    await db.execute({
      sql: "UPDATE players SET hand = ?, current_bet = 50, stack_size = stack_size - 50 WHERE fid = ?",
      args: [hand, fid]
    });
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

    if (action === "join") {
      await db.execute({
        sql: "INSERT OR IGNORE INTO players (fid, stack_size, hand, current_bet) VALUES (?, 5000, '', 0)",
        args: [fid]
      });
      // Auto-deal if it's the first player joining
      const newFids = [...new Set([...activeFids, fid])];
      await dealNewHand(newFids);
    } else if (action === "deal" || currentGameState.phase === "showdown") {
      // Start a new hand
      await dealNewHand(activeFids);
    } else if (action === "fold") {
      // Fold resets/removes player
      await db.execute({
        sql: "DELETE FROM players WHERE fid = ?",
        args: [fid]
      });
      const remainingFids = activeFids.filter(id => id !== fid);
      if (remainingFids.length > 0) {
        await dealNewHand(remainingFids);
      } else {
        await db.execute("UPDATE game_state SET pot_size = 0, current_bet = 0, board = '', deck = '', phase = 'preflop' WHERE id = 'main_table'");
      }
    } else if (currentPlayer) {
      // Process betting actions: check, call, bet, raise, all_in
      if (action === "check") {
        // Can only check if no active bet
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
        // Call completes the street
        const { rows: freshState } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
        await advanceGame(freshState[0]);
      } else if (action === "bet" || action === "raise") {
        // amount represents total target bet size
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

        // Simulate AI Opponent Calling the Bet/Raise
        await db.execute({
          sql: "UPDATE game_state SET pot_size = pot_size + ? WHERE id = 'main_table'",
          args: [betDiff] // AI puts in matching amount to call
        });

        // Advance to next street (since AI calls the bet)
        const { rows: freshState } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
        await advanceGame(freshState[0]);
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

        // Simulate AI Opponent Calling the All-in
        await db.execute({
          sql: "UPDATE game_state SET pot_size = pot_size + ? WHERE id = 'main_table'",
          args: [allInAmount] // AI calls all-in
        });

        // Advance
        const { rows: freshState } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
        await advanceGame(freshState[0]);
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
