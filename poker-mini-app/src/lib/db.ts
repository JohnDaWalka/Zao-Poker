import { createClient } from "@libsql/client";

// Initialize the Turso client
// In local development, we can fallback to a local sqlite file if NEYNAR_API_KEY isn't fully mocked
const url = process.env.TURSO_DATABASE_URL || "file:./poker_local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

export const db = createClient({
  url,
  authToken,
});

export async function initDb() {
  // Drop tables to force clean schema update
  await db.execute("DROP TABLE IF EXISTS game_state");
  await db.execute("DROP TABLE IF EXISTS players");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS game_state (
      id TEXT PRIMARY KEY,
      pot_size INTEGER DEFAULT 0,
      current_turn_fid INTEGER,
      board TEXT DEFAULT '',
      deck TEXT DEFAULT '',
      phase TEXT DEFAULT 'preflop',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS players (
      fid INTEGER PRIMARY KEY,
      stack_size INTEGER DEFAULT 5000,
      hand TEXT DEFAULT '',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Ensure we have a default game state row
  await db.execute(`
    INSERT OR IGNORE INTO game_state (id, pot_size, current_turn_fid, board, deck, phase)
    VALUES ('main_table', 0, NULL, '', '', 'preflop')
  `);
}
