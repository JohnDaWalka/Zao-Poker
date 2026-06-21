import { createClient } from "@libsql/client";

// Initialize the Turso client
// In local development, we can fallback to a local sqlite file if NEYNAR_API_KEY isn't fully mocked
import os from "os";
import path from "path";

const localDbPath = path.join(os.tmpdir(), "poker_local.db");
const url = process.env.TURSO_DATABASE_URL || `file:${localDbPath}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

export const db = createClient({
  url,
  authToken,
});

export async function initDb() {
  // Drop tables to force clean schema update
  await db.execute("DROP TABLE IF EXISTS tables");
  await db.execute("DROP TABLE IF EXISTS players");
  await db.execute("DROP TABLE IF EXISTS game_state"); // drop deprecated table

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      name TEXT,
      max_players INTEGER DEFAULT 6,
      status TEXT DEFAULT 'waiting', -- 'waiting', 'playing', 'finished'
      pot_size INTEGER DEFAULT 0,
      current_bet INTEGER DEFAULT 0,
      board TEXT DEFAULT '',
      deck TEXT DEFAULT '',
      phase TEXT DEFAULT 'preflop',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS players (
      fid INTEGER PRIMARY KEY,
      username TEXT,
      pfp_url TEXT,
      table_id TEXT,
      stack_size INTEGER DEFAULT 5000,
      hand TEXT DEFAULT '',
      current_bet INTEGER DEFAULT 0,
      status TEXT DEFAULT 'waiting', -- 'waiting', 'playing', 'folded'
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Pre-populate default tournament rooms
  await db.execute(`
    INSERT OR IGNORE INTO tables (id, name, max_players, status)
    VALUES 
      ('room_1', 'Heads-Up GTO Match', 2, 'waiting'),
      ('room_2', '6-Max Sit & Go Turbo', 6, 'waiting'),
      ('room_3', 'Meta Labs VR Tourney', 6, 'waiting')
  `);
}
