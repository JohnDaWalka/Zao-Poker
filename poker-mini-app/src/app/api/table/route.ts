import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

// Force database initialization on first run (for local dev)
let initialized = false;

export async function GET() {
  try {
    if (!initialized) {
      await initDb();
      initialized = true;
    }

    const { rows } = await db.execute("SELECT * FROM game_state WHERE id = 'main_table'");
    
    // Also fetch seated players
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
    
    // Simplistic mock logic: If they join, add them to players. If they bet, increase pot.
    if (action === "join") {
      await db.execute({
        sql: "INSERT OR IGNORE INTO players (fid, stack_size) VALUES (?, 5000)",
        args: [fid]
      });
    } else if (["call", "raise", "overbet", "all_in"].includes(action)) {
      await db.execute({
        sql: "UPDATE game_state SET pot_size = pot_size + ? WHERE id = 'main_table'",
        args: [amount || 0]
      });
      await db.execute({
        sql: "UPDATE players SET stack_size = stack_size - ? WHERE fid = ?",
        args: [amount || 0, fid]
      });
    } else if (action === "fold") {
      await db.execute({
        sql: "DELETE FROM players WHERE fid = ?",
        args: [fid]
      });
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
