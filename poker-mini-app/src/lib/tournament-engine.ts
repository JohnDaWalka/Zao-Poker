/**
 * ZAO Poker Tournament Engine — Bracket and multi-table tournament management.
 * 
 * Supports: Sit & Go, Scheduled Tournaments, Multi-table progression,
 * Prize pool distribution, and player elimination tracking.
 */

import { db } from './db';

export interface TournamentConfig {
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

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
}

export interface TournamentPlayer {
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

export interface TournamentTable {
  id: string;
  tournamentId: string;
  seats: (number | null)[]; // fid or null
  status: 'waiting' | 'playing' | 'broken';
}

export const DEFAULT_BLIND_LEVELS: BlindLevel[] = [
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

export const DEFAULT_PRIZE_DISTRIBUTION: Record<number, number[]> = {
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
  const numTables = tables.length;
  let playerIdx = 0;
  for (let i = 0; i < numTables; i++) {
    const table = tables[i];
    const remainingPlayersCount = players.length - playerIdx;
    const remainingTablesCount = numTables - i;
    const tablePlayerCount = Math.ceil(remainingPlayersCount / remainingTablesCount);

    const tablePlayers = players.slice(playerIdx, playerIdx + tablePlayerCount);
    for (let j = 0; j < tablePlayers.length; j++) {
      const p = tablePlayers[j];
      await db.execute({
        sql: `UPDATE tournament_players SET table_id = ?, seat_index = ? WHERE tournament_id = ? AND fid = ?`,
        args: [table.id, j, tournamentId, p.fid],
      });
      await db.execute({
        sql: `INSERT INTO players (fid, username, table_id, seat_index, stack_size, status)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (fid, table_id) DO UPDATE SET
                seat_index = excluded.seat_index,
                stack_size = excluded.stack_size,
                status = excluded.status`,
        args: [p.fid, p.username, table.id, j, tournament.starting_stack, 'waiting'],
      });
    }
    playerIdx += tablePlayerCount;
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
 * Calculate current blind level based on elapsed time since the tournament started.
 */
export async function getTournamentBlinds(tournamentId: string): Promise<{ smallBlind: number; bigBlind: number; ante: number; level: number; nextLevelInSecs: number } | null> {
  const { rows } = await db.execute({
    sql: `SELECT started_at, blind_levels FROM tournaments WHERE id = ?`,
    args: [tournamentId],
  });

  if (rows.length === 0) return null;
  const tourney = rows[0] as any;
  if (!tourney.started_at) {
    const levels = JSON.parse(tourney.blind_levels || '[]') as BlindLevel[];
    const firstLevel = levels[0] || DEFAULT_BLIND_LEVELS[0];
    return {
      smallBlind: firstLevel.smallBlind,
      bigBlind: firstLevel.bigBlind,
      ante: firstLevel.ante,
      level: firstLevel.level,
      nextLevelInSecs: firstLevel.durationMinutes * 60,
    };
  }

  const start = new Date(tourney.started_at).getTime();
  const now = Date.now();
  const elapsedMs = Math.max(0, now - start);
  const levels = JSON.parse(tourney.blind_levels || '[]') as BlindLevel[];

  let cumulativeMs = 0;
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const durationMs = lvl.durationMinutes * 60 * 1000;
    if (elapsedMs < cumulativeMs + durationMs) {
      const nextLevelTimeMs = start + cumulativeMs + durationMs;
      const nextLevelInSecs = Math.max(0, Math.floor((nextLevelTimeMs - now) / 1000));
      
      // Update DB to reflect current blind level
      await db.execute({
        sql: `UPDATE tournaments SET current_blind_level = ? WHERE id = ?`,
        args: [lvl.level, tournamentId]
      });

      return {
        smallBlind: lvl.smallBlind,
        bigBlind: lvl.bigBlind,
        ante: lvl.ante,
        level: lvl.level,
        nextLevelInSecs,
      };
    }
    cumulativeMs += durationMs;
  }

  // If elapsed time exceeds all levels, stay at the final level
  const finalLevel = levels[levels.length - 1] || DEFAULT_BLIND_LEVELS[DEFAULT_BLIND_LEVELS.length - 1];
  
  await db.execute({
    sql: `UPDATE tournaments SET current_blind_level = ? WHERE id = ?`,
    args: [finalLevel.level, tournamentId]
  });

  return {
    smallBlind: finalLevel.smallBlind,
    bigBlind: finalLevel.bigBlind,
    ante: finalLevel.ante,
    level: finalLevel.level,
    nextLevelInSecs: 0,
  };
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
 * Synchronizes player stacks, processes eliminations, breaks tables if needed,
 * and balances players across remaining active tables.
 */
export async function balanceTables(tournamentId: string): Promise<void> {
  // 1. Sync tournament_players stack from players stack_size
  await db.execute({
    sql: `UPDATE tournament_players
          SET stack = COALESCE(
            (SELECT stack_size FROM players 
             WHERE players.fid = tournament_players.fid 
             AND players.table_id = tournament_players.table_id),
            0
          )
          WHERE tournament_id = ? AND status = 'active'`,
    args: [tournamentId]
  });

  // 2. Find and eliminate any player whose stack is <= 0
  const { rows: activePlayersBeforeElim } = await db.execute({
    sql: `SELECT fid, username, table_id, stack FROM tournament_players 
          WHERE tournament_id = ? AND status = 'active'`,
    args: [tournamentId]
  });

  const activeCountBefore = activePlayersBeforeElim.length;

  const { rows: bustedPlayers } = await db.execute({
    sql: `SELECT tp.fid, tp.username, tp.table_id, tp.stack as pre_hand_stack
          FROM tournament_players tp
          LEFT JOIN players p ON tp.fid = p.fid AND tp.table_id = p.table_id
          WHERE tp.tournament_id = ? 
            AND tp.status = 'active' 
            AND (p.stack_size <= 0 OR p.fid IS NULL)`,
    args: [tournamentId]
  });

  if (bustedPlayers.length > 0) {
    // Sort busted players by pre-hand stack descending
    bustedPlayers.sort((a: any, b: any) => Number(b.pre_hand_stack || 0) - Number(a.pre_hand_stack || 0));
    
    for (let i = 0; i < bustedPlayers.length; i++) {
      const p = bustedPlayers[i];
      const finishPosition = activeCountBefore - i;
      await eliminatePlayer(tournamentId, Number(p.fid), finishPosition);
      // Remove from players table
      await db.execute({
        sql: `DELETE FROM players WHERE fid = ? AND table_id = ?`,
        args: [p.fid, p.table_id]
      });
    }
  }

  // 3. Check tournament status (if 1 or 0 players remain, tournament is finished)
  const { rows: activePlayersAfterElim } = await db.execute({
    sql: `SELECT tp.fid, tp.username, tp.table_id, tp.stack, p.seat_index 
          FROM tournament_players tp
          JOIN players p ON tp.fid = p.fid AND tp.table_id = p.table_id
          WHERE tp.tournament_id = ? AND tp.status = 'active'`,
    args: [tournamentId]
  });

  const remainingActiveCount = activePlayersAfterElim.length;

  if (remainingActiveCount <= 1) {
    if (remainingActiveCount === 1) {
      const winner = activePlayersAfterElim[0] as any;
      await db.execute({
        sql: `UPDATE tournament_players SET status = 'cashed', finish_position = 1 
              WHERE tournament_id = ? AND fid = ?`,
        args: [tournamentId, winner.fid]
      });
    }
    await db.execute({
      sql: `UPDATE tournaments SET status = 'finished', finished_at = ? WHERE id = ?`,
      args: [new Date().toISOString(), tournamentId]
    });
    await db.execute({
      sql: `UPDATE tables SET status = 'finished' WHERE tournament_id = ?`,
      args: [tournamentId]
    });
    return;
  }

  // 4. Get active tables
  const { rows: activeTables } = await db.execute({
    sql: `SELECT id, name, status, max_players FROM tables 
          WHERE tournament_id = ? AND status IN ('waiting', 'playing')`,
    args: [tournamentId]
  });

  if (activeTables.length === 0) return;

  const seatsPerTable = 6;
  const idealTableCount = Math.ceil(remainingActiveCount / seatsPerTable);

  // Group active players by table_id
  const playersByTable: Record<string, any[]> = {};
  for (const table of activeTables) {
    playersByTable[String((table as any).id)] = [];
  }
  for (const p of activePlayersAfterElim) {
    const pTableId = String((p as any).table_id);
    if (playersByTable[pTableId]) {
      playersByTable[pTableId].push(p);
    }
  }

  // Break tables if we have more tables than needed
  let currentTables = [...activeTables];
  while (currentTables.length > idealTableCount) {
    currentTables.sort((a: any, b: any) => playersByTable[String(a.id)].length - playersByTable[String(b.id)].length);
    const tableToBreak = currentTables.shift()!;
    const tableToBreakId = String((tableToBreak as any).id);
    
    console.log(`[tournament:${tournamentId}] Breaking table ${tableToBreakId}`);
    
    await db.execute({
      sql: `UPDATE tables SET status = 'broken' WHERE id = ?`,
      args: [tableToBreakId]
    });

    const playersToMove = playersByTable[tableToBreakId];
    delete playersByTable[tableToBreakId];

    for (const player of playersToMove) {
      const targetTable = currentTables
        .filter((t: any) => playersByTable[String(t.id)].length < seatsPerTable)
        .sort((a: any, b: any) => playersByTable[String(a.id)].length - playersByTable[String(b.id)].length)[0];

      if (targetTable) {
        const targetTableId = String((targetTable as any).id);
        const occupiedSeats = new Set(playersByTable[targetTableId].map((p: any) => p.seat_index));
        let newSeat = 0;
        while (occupiedSeats.has(newSeat)) {
          newSeat++;
        }

        await db.execute({
          sql: `UPDATE tournament_players SET table_id = ?, seat_index = ? WHERE tournament_id = ? AND fid = ?`,
          args: [targetTableId, newSeat, tournamentId, player.fid]
        });

        await db.execute({
          sql: `DELETE FROM players WHERE fid = ? AND table_id = ?`,
          args: [player.fid, tableToBreakId]
        });

        await db.execute({
          sql: `INSERT INTO players (fid, username, table_id, seat_index, stack_size, status)
                VALUES (?, ?, ?, ?, ?, 'waiting')`,
          args: [player.fid, player.username, targetTableId, newSeat, player.stack]
        });

        player.table_id = targetTableId;
        player.seat_index = newSeat;
        playersByTable[targetTableId].push(player);
      }
    }
  }

  // Balance remaining tables if the difference in player counts is >= 2
  while (currentTables.length > 1) {
    currentTables.sort((a: any, b: any) => playersByTable[String(a.id)].length - playersByTable[String(b.id)].length);
    const minTable = currentTables[0];
    const maxTable = currentTables[currentTables.length - 1];
    
    const minTableId = String((minTable as any).id);
    const maxTableId = String((maxTable as any).id);

    const minCount = playersByTable[minTableId].length;
    const maxCount = playersByTable[maxTableId].length;

    if (maxCount - minCount <= 1) {
      break; // Balanced!
    }

    // Move player from maxTable to minTable
    const maxPlayers = playersByTable[maxTableId].sort((a: any, b: any) => b.seat_index - a.seat_index);
    const playerToMove = maxPlayers[0];

    const occupiedSeats = new Set(playersByTable[minTableId].map((p: any) => p.seat_index));
    let newSeat = 0;
    while (occupiedSeats.has(newSeat)) {
      newSeat++;
    }

    await db.execute({
      sql: `UPDATE tournament_players SET table_id = ?, seat_index = ? WHERE tournament_id = ? AND fid = ?`,
      args: [minTableId, newSeat, tournamentId, playerToMove.fid]
    });

    await db.execute({
      sql: `DELETE FROM players WHERE fid = ? AND table_id = ?`,
      args: [playerToMove.fid, maxTableId]
    });

    await db.execute({
      sql: `INSERT INTO players (fid, username, table_id, seat_index, stack_size, status)
            VALUES (?, ?, ?, ?, ?, 'waiting')`,
      args: [playerToMove.fid, playerToMove.username, minTableId, newSeat, playerToMove.stack]
    });

    playerToMove.table_id = minTableId;
    playerToMove.seat_index = newSeat;

    playersByTable[maxTableId] = playersByTable[maxTableId].filter((p: any) => p.fid !== playerToMove.fid);
    playersByTable[minTableId].push(playerToMove);
  }
}

/**
 * Break a table and redistribute players.
 */
export async function breakTable(tournamentId: string, tableId: string): Promise<void> {
  // Mark table as broken
  await db.execute({
    sql: `UPDATE tables SET status = ? WHERE id = ?`,
    args: ['broken', tableId],
  });

  // Re-balance tables (which automatically handles broken tables by redistributing players)
  await balanceTables(tournamentId);
}

/**
 * Get tournament standings (leaderboard).
 */
export async function getTournamentStandings(tournamentId: string): Promise<any[]> {
  const { rows } = await db.execute({
    sql: `SELECT * FROM tournament_players WHERE tournament_id = ? ORDER BY 
          CASE WHEN finish_position IS NOT NULL THEN finish_position ELSE 0 END ASC,
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
