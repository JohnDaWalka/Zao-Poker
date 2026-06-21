import { createClient } from "@libsql/client";

// Initialize the Turso client
// In local development, we can fallback to a local sqlite file if NEYNAR_API_KEY isn't fully mocked
import os from "os";
import path from "path";

const localDbPath = path.join(os.tmpdir(), "poker_local.db");
const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.TURSO_CONNECTION_URL ||
  `file:${localDbPath}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

export const db = createClient({
  url,
  authToken,
});

let initializationPromise: Promise<void> | null = null;

async function addMissingColumns(
  table: string,
  columns: Record<string, string>,
) {
  const { rows } = await db.execute(`PRAGMA table_info(${table})`);
  const existingColumns = new Set(rows.map((row) => String(row.name)));

  for (const [name, definition] of Object.entries(columns)) {
    if (!existingColumns.has(name)) {
      try {
        await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      } catch (error) {
        // Separate serverless instances can race during the first migration.
        // A duplicate means the other instance completed the same safe change.
        if (!String(error).toLowerCase().includes("duplicate column")) {
          throw error;
        }
      }
    }
  }
}

async function initializeDb() {
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
      start_time DATETIME,
      current_turn_fid INTEGER,
      last_aggressor_fid INTEGER,
      turn_started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS players (
      fid INTEGER PRIMARY KEY,
      username TEXT,
      pfp_url TEXT,
      table_id TEXT,
      seat_index INTEGER,
      stack_size INTEGER DEFAULT 5000,
      hand TEXT DEFAULT '',
      current_bet INTEGER DEFAULT 0,
      status TEXT DEFAULT 'waiting', -- 'waiting', 'playing', 'folded', 'sitting_out'
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Existing Turso databases predate the multiplayer columns. Migrate them
  // in place so a serverless cold start never deletes active tables or seats.
  await addMissingColumns("tables", {
    start_time: "DATETIME",
    current_turn_fid: "INTEGER",
    last_aggressor_fid: "INTEGER",
    turn_started_at: "DATETIME",
    updated_at: "DATETIME",
  });

  await addMissingColumns("players", {
    seat_index: "INTEGER",
    status: "TEXT DEFAULT 'waiting'",
    last_seen: "DATETIME",
  });

  // Pre-populate default tournament rooms with start times
  const now = new Date();
  // Room 1 is the immediately playable practice table.
  const time1 = now.toISOString();
  // Room 2: starts in 30 minutes
  const time2 = new Date(now.getTime() + 30 * 60000).toISOString();
  // Room 3: starts in 2 hours
  const time3 = new Date(now.getTime() + 120 * 60000).toISOString();

  await db.execute({
    sql: `
      INSERT OR IGNORE INTO tables (id, name, max_players, status, start_time)
      VALUES 
        ('room_1', 'Heads-Up GTO Match', 2, 'waiting', ?),
        ('room_2', '6-Max Sit & Go Turbo', 6, 'waiting', ?),
        ('room_3', 'Meta Labs VR Tourney', 6, 'waiting', ?)
    `,
    args: [time1, time2, time3]
  });

  // Populate schedules only for legacy rows that existed before start_time.
  await db.execute({
    sql: `
      UPDATE tables
      SET start_time = CASE id
        WHEN 'room_1' THEN ?
        WHEN 'room_2' THEN ?
        WHEN 'room_3' THEN ?
        ELSE start_time
      END
      WHERE start_time IS NULL
    `,
    args: [time1, time2, time3],
  });

  await db.execute(
    "UPDATE tables SET turn_started_at = COALESCE(turn_started_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)",
  );
  await db.execute(
    "UPDATE players SET last_seen = COALESCE(last_seen, CURRENT_TIMESTAMP)",
  );
}

export async function initDb() {
  if (!initializationPromise) {
    initializationPromise = initializeDb().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
}
