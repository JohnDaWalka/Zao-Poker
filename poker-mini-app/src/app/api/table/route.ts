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

// Deal a new hand
async function dealNewHand(fids: number[]) {
  const deck = createDeck();
  
  // Deal 2 cards to each player
  for (const fid of fids) {
    const c1 = deck.pop();
    const c2 = deck.pop();
    const hand = `${c1},${c2}`;
    await db.execute({
      sql: "UPDATE players SET hand = ? WHERE fid = ?",
      args: [hand, fid]
    });
  }

  const deckStr = deck.join(",");
  await db.execute({
    sql: "UPDATE game_state SET pot_size = 0, board = '', deck = ?, phase = 'preflop' WHERE id = 'main_table'",
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

  if (phase === "preflop") {
    // Deal Flop (3 cards)
    const c1 = deck.pop();
    const c2 = deck.pop();
    const c3 = deck.pop();
    if (c1 && c2 && c3) board.push(c1, c2, c3);
    await db.execute({
      sql: "UPDATE game_state SET board = ?, deck = ?, phase = 'flop' WHERE id = 'main_table'",
      args: [board.join(","), deck.join(",")]
    });
  } else if (phase === "flop") {
    // Deal Turn (1 card)
    const c = deck.pop();
    if (c) board.push(c);
    await db.execute({
      sql: "UPDATE game_state SET board = ?, deck = ?, phase = 'turn' WHERE id = 'main_table'",
      args: [board.join(","), deck.join(",")]
    });
  } else if (phase === "turn") {
    // Deal River (1 card)
    const c = deck.pop();
    if (c) board.push(c);
    await db.execute({
      sql: "UPDATE game_state SET board = ?, deck = ?, phase = 'river' WHERE id = 'main_table'",
      args: [board.join(","), deck.join(",")]
    });
  } else if (phase === "river") {
    // Showdown phase
    await db.execute({
      sql: "UPDATE game_state SET phase = 'showdown' WHERE id = 'main_table'",
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
    const { rows: players } = await db.execute("SELECT fid, stack_size, hand FROM players");

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

    const { rows: playerRows } = await db.execute("SELECT fid FROM players");
    const activeFids = playerRows.map((r: any) => r.fid);

    if (action === "join") {
      await db.execute({
        sql: "INSERT OR IGNORE INTO players (fid, stack_size, hand) VALUES (?, 5000, '')",
        args: [fid]
      });
      // Auto-deal if it's the first player joining
      if (activeFids.length === 0 || !activeFids.includes(fid)) {
        const newFids = [...new Set([...activeFids, fid])];
        await dealNewHand(newFids);
      }
    } else if (action === "deal" || currentGameState.phase === "showdown") {
      // Start a new hand
      await dealNewHand(activeFids);
    } else if (action === "fold") {
      // Fold resets to lobby / removes player
      await db.execute({
        sql: "DELETE FROM players WHERE fid = ?",
        args: [fid]
      });
      const remainingFids = activeFids.filter(id => id !== fid);
      if (remainingFids.length > 0) {
        await dealNewHand(remainingFids);
      } else {
        await db.execute("UPDATE game_state SET pot_size = 0, board = '', deck = '', phase = 'preflop' WHERE id = 'main_table'");
      }
    } else if (["call", "raise", "overbet", "all_in"].includes(action)) {
      // Apply bet
      await db.execute({
        sql: "UPDATE game_state SET pot_size = pot_size + ? WHERE id = 'main_table'",
        args: [amount || 0]
      });
      await db.execute({
        sql: "UPDATE players SET stack_size = stack_size - ? WHERE fid = ?",
        args: [amount || 0, fid]
      });
      
      // Fetch fresh game state and advance phase
      const { rows: freshState } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
      await advanceGame(freshState[0]);
    }

    // Return the updated state
    const { rows } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
    const { rows: players } = await db.execute("SELECT fid, stack_size, hand FROM players");

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
