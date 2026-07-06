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
      game_type TEXT DEFAULT 'NLHE',
      stakes_label TEXT DEFAULT '$0.50 / $1',
      max_players INTEGER DEFAULT 6,
      buy_in INTEGER DEFAULT 50,
      status TEXT DEFAULT 'waiting', -- 'waiting', 'playing', 'finished'
      pot_size INTEGER DEFAULT 0,
      current_bet INTEGER DEFAULT 0,
      board TEXT DEFAULT '',
      deck TEXT DEFAULT '',
      action_history TEXT DEFAULT '',
      phase TEXT DEFAULT 'preflop',
      start_time DATETIME,
      created_by_fid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      current_turn_fid INTEGER,
      last_aggressor_fid INTEGER,
      dealer_seat_index INTEGER DEFAULT 0,
      turn_started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Migration: add min_vet_score to tables for user reputation gating
  try {
    await db.execute(`ALTER TABLE tables ADD COLUMN min_vet_score REAL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // ── Migration: add neynar_score to players for caching user reputation
  try {
    await db.execute(`ALTER TABLE players ADD COLUMN neynar_score REAL DEFAULT 0.5`);
  } catch {
    // Column already exists — ignore
  }

  // ── Migration: players PK was originally `fid INTEGER PRIMARY KEY` which
  // prevented multi-tabling. Recreate with composite PK if necessary.
  const { rows: pkInfo } = await db.execute(`PRAGMA table_info(players)`);
  const hasCompositePk = pkInfo.some((row: any) => String(row.name) === "table_id" && Number(row.pk) > 0);
  if (!hasCompositePk) {
    // SQLite doesn't allow ALTER TABLE for PK changes; recreate with temp table.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS players_new (
        fid INTEGER NOT NULL,
        username TEXT,
        pfp_url TEXT,
        table_id TEXT NOT NULL,
        seat_index INTEGER,
        stack_size INTEGER DEFAULT 5000,
        hand TEXT DEFAULT '',
        current_bet INTEGER DEFAULT 0,
        status TEXT DEFAULT 'waiting',
        is_bot INTEGER DEFAULT 0,
        is_ready INTEGER DEFAULT 0,
        has_acted INTEGER DEFAULT 0,
        total_invested INTEGER DEFAULT 0,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        visible_cards TEXT DEFAULT '',
        PRIMARY KEY (fid, table_id)
      )
    `);
    // Only migrate if old players table exists (first-run has no players table yet)
    try {
      await db.execute(`
        INSERT OR IGNORE INTO players_new (
          fid, username, pfp_url, table_id, seat_index, stack_size, hand,
          current_bet, status, is_bot, is_ready, has_acted, total_invested,
          joined_at, last_seen
        )
        SELECT
          fid, username, pfp_url, table_id, seat_index, stack_size, hand,
          current_bet, status, is_bot, is_ready, has_acted, total_invested,
          joined_at, last_seen
        FROM players
      `);
    } catch {
      // Old players table doesn't exist yet (first run) — nothing to migrate
    }
    await db.execute(`DROP TABLE IF EXISTS players`);
    await db.execute(`ALTER TABLE players_new RENAME TO players`);
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS players (
      fid INTEGER NOT NULL,
      username TEXT,
      pfp_url TEXT,
      table_id TEXT NOT NULL,
      seat_index INTEGER,
      stack_size INTEGER DEFAULT 5000,
      hand TEXT DEFAULT '',
      current_bet INTEGER DEFAULT 0,
      status TEXT DEFAULT 'waiting',
      is_bot INTEGER DEFAULT 0,
      is_ready INTEGER DEFAULT 0,
      has_acted INTEGER DEFAULT 0,
      total_invested INTEGER DEFAULT 0,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      visible_cards TEXT DEFAULT '',
      PRIMARY KEY (fid, table_id)
    )
  `);

  // One row per player per resolved hand (fold-win or showdown), feeding
  // Hand Analysis / Analytics. Hands are immutable once recorded.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS hand_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id TEXT,
      fid INTEGER,
      username TEXT,
      hole_cards TEXT,
      board TEXT,
      result TEXT, -- 'win', 'loss', 'split'
      net_amount INTEGER DEFAULT 0,
      pot_size INTEGER DEFAULT 0,
      phase_reached TEXT, -- 'preflop', 'flop', 'turn', 'river', 'showdown'
      resolution TEXT, -- 'fold', 'showdown'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_hand_history_fid_created ON hand_history(fid, created_at)",
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS table_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id TEXT NOT NULL,
      fid INTEGER NOT NULL,
      username TEXT NOT NULL,
      pfp_url TEXT DEFAULT '',
      is_bot INTEGER DEFAULT 0,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_table_chat_messages_table_created ON table_chat_messages(table_id, created_at)",
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_chat_mutes (
      fid INTEGER NOT NULL,
      muted_fid INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (fid, muted_fid)
    )
  `);
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_user_chat_mutes_fid ON user_chat_mutes(fid, muted_fid)",
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS table_chat_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      reporter_fid INTEGER NOT NULL,
      reported_fid INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      reviewed_by_fid INTEGER,
      reviewed_at DATETIME,
      resolution_note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_table_chat_reports_table_created ON table_chat_reports(table_id, created_at)",
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      created_by_fid INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS club_memberships (
      club_id TEXT NOT NULL,
      fid INTEGER NOT NULL,
      username TEXT,
      pfp_url TEXT DEFAULT '',
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (club_id, fid)
    )
  `);
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_club_memberships_fid ON club_memberships(fid, club_id)",
  );

  // Running per-player aggregates for Leaderboards / Dashboard, updated
  // alongside each hand_history insert so leaderboard reads stay O(1).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS player_stats (
      fid INTEGER PRIMARY KEY,
      username TEXT,
      pfp_url TEXT,
      hands_played INTEGER DEFAULT 0,
      hands_won INTEGER DEFAULT 0,
      net_winnings INTEGER DEFAULT 0,
      biggest_pot_won INTEGER DEFAULT 0,
      current_streak INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      last_played_at DATETIME
    )
  `);

  // Existing Turso databases predate the multiplayer columns. Migrate them
  // in place so a serverless cold start never deletes active tables or seats.
  await addMissingColumns("tables", {
    last_raise_amount: "INTEGER DEFAULT 0",
    name: "TEXT",
    game_type: "TEXT DEFAULT 'NLHE'",
    stakes_label: "TEXT DEFAULT '$0.50 / $1'",
    max_players: "INTEGER DEFAULT 6",
    buy_in: "INTEGER DEFAULT 50",
    status: "TEXT DEFAULT 'waiting'",
    pot_size: "INTEGER DEFAULT 0",
    current_bet: "INTEGER DEFAULT 0",
    board: "TEXT DEFAULT ''",
    deck: "TEXT DEFAULT ''",
    action_history: "TEXT DEFAULT ''",
    phase: "TEXT DEFAULT 'preflop'",
    start_time: "DATETIME",
    created_by_fid: "INTEGER",
    created_at: "DATETIME",
    current_turn_fid: "INTEGER",
    last_aggressor_fid: "INTEGER",
    dealer_seat_index: "INTEGER DEFAULT 0",
    turn_started_at: "DATETIME",
    updated_at: "DATETIME",
    visibility: "TEXT DEFAULT 'public'",
    club_id: "TEXT",
    club_name: "TEXT DEFAULT ''",
  });

  await addMissingColumns("players", {
    seat_index: "INTEGER",
    status: "TEXT DEFAULT 'waiting'",
    is_bot: "INTEGER DEFAULT 0",
    is_ready: "INTEGER DEFAULT 0",
    last_seen: "DATETIME",
    has_acted: "INTEGER DEFAULT 0",
    // Total chips put into the pot this hand (antes + blinds + every
    // bet/call/raise/all-in), reset at the start of each new hand. Used to
    // compute each player's net win/loss for hand_history / player_stats.
    total_invested: "INTEGER DEFAULT 0",
    // Face-up (visible) cards for stud variants. Comma-separated card strings.
    visible_cards: "TEXT DEFAULT ''",
  });

  await addMissingColumns("table_chat_reports", {
    status: "TEXT DEFAULT 'open'",
    reviewed_by_fid: "INTEGER",
    reviewed_at: "DATETIME",
    resolution_note: "TEXT DEFAULT ''",
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
      INSERT OR IGNORE INTO tables (id, name, game_type, stakes_label, max_players, buy_in, status, start_time)
      VALUES 
        ('room_1', 'Heads-Up GTO Match', 'NLHE', '$0.10 / $0.25', 2, 25, 'waiting', ?),
        ('room_2', '6-Max Sit & Go Turbo', 'NLHE', '$1 / $2', 6, 50, 'waiting', ?),
        ('room_3', 'Meta Labs VR Tourney', 'NLHE', '$2 / $5', 6, 100, 'waiting', ?)
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

  await db.execute(`
    UPDATE tables
    SET
      game_type = COALESCE(game_type, 'NLHE'),
      stakes_label = COALESCE(
        stakes_label,
        CASE id
          WHEN 'room_1' THEN '$0.10 / $0.25'
          WHEN 'room_2' THEN '$1 / $2'
          WHEN 'room_3' THEN '$2 / $5'
          ELSE '$0.50 / $1'
        END
      ),
      buy_in = COALESCE(
        buy_in,
        CASE id
          WHEN 'room_1' THEN 25
          WHEN 'room_2' THEN 50
          WHEN 'room_3' THEN 100
          ELSE 50
        END
      ),
      visibility = COALESCE(visibility, 'public'),
      club_name = COALESCE(club_name, ''),
      action_history = COALESCE(action_history, ''),
      created_at = COALESCE(created_at, CURRENT_TIMESTAMP)
  `);

  await db.execute(
    "UPDATE tables SET turn_started_at = COALESCE(turn_started_at, CURRENT_TIMESTAMP), created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)",
  );
  await db.execute(
    "UPDATE players SET is_bot = COALESCE(is_bot, 0), is_ready = COALESCE(is_ready, 0), total_invested = COALESCE(total_invested, 0), last_seen = COALESCE(last_seen, CURRENT_TIMESTAMP)",
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
