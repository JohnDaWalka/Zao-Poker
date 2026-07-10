/**
 * ZAO Poker Tournament Engine — Bracket and multi-table tournament management.
 * 
 * Supports: Sit & Go, Scheduled Tournaments, Multi-table progression,
 * Prize pool distribution, and player elimination tracking.
 */

import { db } from './db';

interface TournamentConfig {
  id: string;
  name: string;
  gameType: string;
  buyIn: number;
  entryFee: number;
  startingStack: number;
  maxPlayers: number;
  minPlayers: number;
  blindLevels: BlindLevel[];
  prizeDistribution: number[]; // Percentages (e.g., [50, 30, 20] for 1st/2nd/3rd)
  lateRegistrationMinutes: number;
  rebuysAllowed: number;
  addonAllowed: boolean;
}

interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
}

interface TournamentPlayer {
  fid: number;
  username: string;
  tableId: string | null;
  seatIndex: number | null;
  stack: number;
  status: 'active' | 'eliminated' | 'busted' | 'cashed';
  eliminatedAt: string | null;
  finishPosition: number | null;
  rebuysUsed: number;
  addonUsed: boolean;
}

interface TournamentTable {
  id: string;
  tournamentId: string;
  seats: (number | null)[]; // fid or null
  status: 'waiting' | 'playing' | 'broken';
}

const DEFAULT_BLIND_LEVELS: BlindLevel[] = [
  { level: 1, smallBlind: 10, bigBlind: 20, ante: 0, durationMinutes: 10 },
  { level: 2, smallBlind: 15, bigBlind: 30, ante: 0, durationMinutes: 10 },
  { level: 3, smallBlind: 20, bigBlind: 40, ante: 5, durationMinutes: 10 },
  { level: 4, smallBlind: 30, bigBlind: 60, ante: 5, durationMinutes: 10 },
  { level: 5, smallBlind: 50, bigBlind: 100, ante: 10, durationMinutes: 10 },
  { level: 6, smallBlind: 75, bigBlind: 150, ante: 15, durationMinutes: 10 },
  { level: 7, smallBlind: 100, bigBlind: 200, ante: 20, durationMinutes: 10 },
  { level: 8, smallBlind: 150, bigBlind: 300, ante: 30, durationMinutes: 10 },
  { level: 9, smallBlind: 200, bigBlind: 400, ante: 40, durationMinutes: 10 },
  { level: 10, smallBlind: 300, bigBlind: 600, ante: 60, durationMinutes: 10 },
  { level: 11, smallBlind: 500, bigBlind: 1000, ante: 100, durationMinutes: 10 },
  { level: 12, smallBlind: 700, bigBlind: 1400, ante: 140, durationMinutes: 10 },
  { level: 13, smallBlind: 1000, bigBlind: 2000, ante: 200, durationMinutes: 10 },
  { level: 14, smallBlind: 1500, bigBlind: 3000, ante: 300, durationMinutes: 10 },
  { level: 15, smallBlind: 2000, bigBlind: 4000, ante: 400, durationMinutes: 10 },
  { level: 16, smallBlind: 3000, bigBlind: 6000, ante: 600, durationMinutes: 10 },
  { level: 17, smallBlind: 5000, bigBlind: 10000, ante: 1000, durationMinutes: 10 },
  { level: 18, smallBlind: 7000, bigBlind: 14000, ante: 1400, durationMinutes: 10 },
  { level: 19, smallBlind: 10000, bigBlind: 20000, ante: 2000, durationMinutes: 10 },
  { level: 20, smallBlind: 15000, bigBlind: 30000, ante: 3000, durationMinutes: 10 },
];

const DEFAULT_PRIZE_DISTRIBUTION: Record<number, number[]> = {
  2: [100],
  3: [60, 40],
  4: [50, 30, 20],
  5: [45, 25, 18, 12],
  6: [40, 24, 16, 12, 8],
  7: [38, 23, 15, 11, 8, 5],
  8: [35, 22, 14, 10, 8, 6, 5],
  9: [33, 20, 13, 10, 8, 6, 5, 5],
  10: [30, 20, 12, 9, 7, 6, 5, 5, 4],
};

/**
 * Create a new tournament with tables and blind structure.
 */
export async function createTournament(config: Partial<TournamentConfig>): Promise<string> {
  const id = `tourney_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const maxPlayers = config.maxPlayers || 6;
  const seatsPerTable = 6;
  const numTables = Math.ceil(maxPlayers / seatsPerTable);

  const prizeDist = config.prizeDistribution || DEFAULT_PRIZE_DISTRIBUTION[Math.min(maxPlayers, 10)] || [50, 30, 20];

  // Create tournament record
  await db.execute({
    sql: `INSERT INTO tournaments (
      id, name, game_type, buy_in, entry_fee, starting_stack, max_players,
      min_players, status, prize_distribution, blind_levels, rebuys_allowed,
      addon_allowed, created_at, late_registration_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      config.name || 'ZAO Tournament',
      config.gameType || 'NLHE',
      config.buyIn || 50,
      config.entryFee || 5,
      config.startingStack || 5000,
      maxPlayers,
      config.minPlayers || 2,
      'registering',
      JSON.stringify(prizeDist),
      JSON.stringify(config.blindLevels || DEFAULT_BLIND_LEVELS),
      config.rebuysAllowed || 0,
      config.addonAllowed || false,
      new Date().toISOString(),
      config.lateRegistrationMinutes || 10,
    ],
  });

  // Create tournament tables
  for (let i = 0; i < numTables; i++) {
    const tableId = `${id}_table_${i}`;
    await db.execute({
      sql: `INSERT INTO tables (id, name, game_type, max_players, buy_in, status, tournament_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        tableId,
        `${config.name || 'Table'} ${i + 1}`,
        config.gameType || 'NLHE',
        seatsPerTable,
        config.buyIn || 50,
        'waiting',
        id,
      ],
    });
  }

  return id;
}

/**
 * Register a player for a tournament.
 */
export async function registerPlayer(tournamentId: string, fid: number, username: string): Promise<boolean> {
  // Check if tournament exists and is open
  const { rows: tourneyRows } = await db.execute({
    sql: 'SELECT * FROM tournaments WHERE id = ?',
    args: [tournamentId],
  });
  if (tourneyRows.length === 0) return false;
  const tournament = tourneyRows[0] as any;

  if (tournament.status !== 'registering' && tournament.status !== 'late_registration') {
    return false;
  }

  // Check if already registered
  const { rows: existing } = await db.execute({
    sql: 'SELECT * FROM tournament_players WHERE tournament_id = ? AND fid = ?',
    args: [tournamentId, fid],
  });
  if (existing.length > 0) return false;

  // Register player
  await db.execute({
    sql: `INSERT INTO tournament_players (
      tournament_id, fid, username, status, stack, rebuys_used, addon_used, registered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [tournamentId, fid, username, 'active', tournament.starting_stack, 0, false, new Date().toISOString()],
  });

  // Update tournament player count
  await db.execute({
    sql: 'UPDATE tournaments SET current_players = COALESCE(current_players, 0) + 1 WHERE id = ?',
    args: [tournamentId],
  });

  return true;
}

/**
 * Start the tournament: seat players, begin first hands.
 */
export async function startTournament(tournamentId: string): Promise<boolean> {
  const { rows: tourneyRows } = await db.execute({
    sql: 'SELECT * FROM tournaments WHERE id = ?',
    args: [tournamentId],
  });
  if (tourneyRows.length === 0) return false;
  const tournament = tourneyRows[0] as any;

  if (tournament.status !== 'registering') return false;
  if ((tournament.current_players || 0) < tournament.min_players) return false;

  // Get all registered players
  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM tournament_players WHERE tournament_id = ? AND status = ?',
    args: [tournamentId, 'active'],
  });
  const players = playerRows as any[];

  // Get tournament tables
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT * FROM tables WHERE tournament_id = ? AND status = ?',
    args: [tournamentId, 'waiting'],
  });
  const tables = tableRows as any[];

  // Seat players evenly across tables
  const seatsPerTable = 6;
  let playerIdx = 0;
  for (const table of tables) {
    const tablePlayers = players.slice(playerIdx, playerIdx + seatsPerTable);
    for (let i = 0; i < tablePlayers.length; i++) {
      const p = tablePlayers[i];
      await db.execute({
        sql: `UPDATE tournament_players SET table_id = ?, seat_index = ? WHERE tournament_id = ? AND fid = ?`,
        args: [table.id, i, tournamentId, p.fid],
      });
      await db.execute({
        sql: `INSERT INTO players (fid, username, table_id, seat_index, stack_size, status)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (fid, table_id) DO UPDATE SET
                seat_index = excluded.seat_index,
                stack_size = excluded.stack_size,
                status = excluded.status`,
        args: [p.fid, p.username, table.id, i, tournament.starting_stack, 'waiting'],
      });
    }
    playerIdx += seatsPerTable;
  }

  // Update tournament status
  await db.execute({
    sql: `UPDATE tournaments SET status = ?, started_at = ? WHERE id = ?`,
    args: ['running', new Date().toISOString(), tournamentId],
  });

  // Start hands on all tables
  for (const table of tables) {
    await db.execute({
      sql: `UPDATE tables SET status = ? WHERE id = ?`,
      args: ['playing', table.id],
    });
  }

  return true;
}

/**
 * Calculate prize pool and payouts.
 */
export function calculatePrizes(buyIn: number, entryFee: number, playerCount: number, distribution: number[]): Array<{ position: number; amount: number; percentage: number }> {
  const totalPool = (buyIn * playerCount);
  const prizes: Array<{ position: number; amount: number; percentage: number }> = [];

  for (let i = 0; i < distribution.length && i < playerCount; i++) {
    const percentage = distribution[i];
    const amount = Math.floor(totalPool * (percentage / 100));
    prizes.push({ position: i + 1, amount, percentage });
  }

  return prizes;
}

/**
 * Eliminate a player from the tournament.
 */
export async function eliminatePlayer(tournamentId: string, fid: number, finishPosition: number): Promise<void> {
  await db.execute({
    sql: `UPDATE tournament_players SET status = ?, finish_position = ?, eliminated_at = ?
          WHERE tournament_id = ? AND fid = ?`,
    args: ['eliminated', finishPosition, new Date().toISOString(), tournamentId, fid],
  });

  // Check if tournament is over (1 player left)
  const { rows } = await db.execute({
    sql: `SELECT COUNT(*) as count FROM tournament_players WHERE tournament_id = ? AND status = ?`,
    args: [tournamentId, 'active'],
  });
  const remaining = (rows[0] as any)?.count || 0;

  if (remaining <= 1) {
    await db.execute({
      sql: `UPDATE tournaments SET status = ?, finished_at = ? WHERE id = ?`,
      args: ['finished', new Date().toISOString(), tournamentId],
    });
  }
}

/**
 * Break a table and redistribute players.
 */
export async function breakTable(tournamentId: string, tableId: string): Promise<void> {
  // Get players from broken table
  const { rows: playerRows } = await db.execute({
    sql: `SELECT * FROM tournament_players WHERE tournament_id = ? AND table_id = ? AND status = ?`,
    args: [tournamentId, tableId, 'active'],
  });
  const players = playerRows as any[];

  // Get other active tables
  const { rows: tableRows } = await db.execute({
    sql: `SELECT * FROM tables WHERE tournament_id = ? AND id != ? AND status = ?`,
    args: [tournamentId, tableId, 'playing'],
  });
  const otherTables = tableRows as any[];

  // Redistribute players to other tables
  for (const player of players) {
    // Find table with open seat
    for (const targetTable of otherTables) {
      const { rows: seatRows } = await db.execute({
        sql: `SELECT COUNT(*) as count FROM players WHERE table_id = ? AND status != ?`,
        args: [targetTable.id, 'folded'],
      });
      const seatCount = (seatRows[0] as any)?.count || 0;
      if (seatCount < 6) {
        await db.execute({
          sql: `UPDATE tournament_players SET table_id = ?, seat_index = ? WHERE tournament_id = ? AND fid = ?`,
          args: [targetTable.id, seatCount, tournamentId, player.fid],
        });
        await db.execute({
          sql: `UPDATE players SET table_id = ?, seat_index = ? WHERE fid = ? AND table_id = ?`,
          args: [targetTable.id, seatCount, player.fid, tableId],
        });
        break;
      }
    }
  }

  // Mark table as broken
  await db.execute({
    sql: `UPDATE tables SET status = ? WHERE id = ?`,
    args: ['broken', tableId],
  });
}

/**
 * Get tournament standings (leaderboard).
 */
export async function getTournamentStandings(tournamentId: string): Promise<any[]> {
  const { rows } = await db.execute({
    sql: `SELECT * FROM tournament_players WHERE tournament_id = ? ORDER BY 
          CASE WHEN finish_position IS NOT NULL THEN finish_position ELSE 0 END DESC,
          stack DESC`,
    args: [tournamentId],
  });
  return rows as any[];
}

/**
 * Initialize tournament database tables.
 */
export async function initTournamentTables(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      game_type TEXT DEFAULT 'NLHE',
      buy_in INTEGER DEFAULT 50,
      entry_fee INTEGER DEFAULT 5,
      starting_stack INTEGER DEFAULT 5000,
      max_players INTEGER DEFAULT 6,
      min_players INTEGER DEFAULT 2,
      current_players INTEGER DEFAULT 0,
      status TEXT DEFAULT 'registering',
      prize_distribution TEXT,
      blind_levels TEXT,
      current_blind_level INTEGER DEFAULT 0,
      rebuys_allowed INTEGER DEFAULT 0,
      addon_allowed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      finished_at DATETIME,
      late_registration_minutes INTEGER DEFAULT 10
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tournament_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id TEXT NOT NULL,
      fid INTEGER NOT NULL,
      username TEXT,
      table_id TEXT,
      seat_index INTEGER,
      stack INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      finish_position INTEGER,
      eliminated_at DATETIME,
      rebuys_used INTEGER DEFAULT 0,
      addon_used INTEGER DEFAULT 0,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tournament_id, fid)
    )
  `);

  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_tournament_players_tourney ON tournament_players(tournament_id, status)"
  );
}
