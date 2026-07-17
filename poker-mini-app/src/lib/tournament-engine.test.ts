import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import {
  createTournament,
  registerPlayer,
  startTournament,
  getTournamentBlinds,
  balanceTables,
  getTournamentStandings,
  initTournamentTables,
  DEFAULT_BLIND_LEVELS,
} from './tournament-engine';

describe('Tournament Engine', () => {
  beforeEach(async () => {
    // Clear and initialize tables before each test
    await db.execute('DROP TABLE IF EXISTS tournaments');
    await db.execute('DROP TABLE IF EXISTS tournament_players');
    await db.execute('DROP TABLE IF EXISTS tables');
    await db.execute('DROP TABLE IF EXISTS players');
    await initTournamentTables();
    
    // Ensure regular table/players schemas exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tables (
        id TEXT PRIMARY KEY,
        name TEXT,
        game_type TEXT DEFAULT 'NLHE',
        stakes_label TEXT DEFAULT '$0.50 / $1',
        max_players INTEGER DEFAULT 6,
        buy_in INTEGER DEFAULT 50,
        status TEXT DEFAULT 'waiting',
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        tournament_id TEXT
      )
    `);

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
  });

  it('should create a tournament and its tables', async () => {
    const tournamentId = await createTournament({
      name: 'Test Tournament',
      maxPlayers: 12,
      buyIn: 100,
    });

    expect(tournamentId).toBeDefined();
    expect(tournamentId.startsWith('tourney_')).toBe(true);

    const { rows: tourneys } = await db.execute({
      sql: 'SELECT * FROM tournaments WHERE id = ?',
      args: [tournamentId],
    });
    expect(tourneys.length).toBe(1);
    expect(tourneys[0].name).toBe('Test Tournament');
    expect(tourneys[0].max_players).toBe(12);

    const { rows: tables } = await db.execute({
      sql: 'SELECT * FROM tables WHERE tournament_id = ?',
      args: [tournamentId],
    });
    // With 12 maxPlayers and 6 seats per table, it should create 2 tables
    expect(tables.length).toBe(2);
  });

  it('should register players up to the limit', async () => {
    const tournamentId = await createTournament({ maxPlayers: 3 });

    const reg1 = await registerPlayer(tournamentId, 1, 'Alice');
    const reg2 = await registerPlayer(tournamentId, 2, 'Bob');
    const reg3 = await registerPlayer(tournamentId, 1, 'Alice'); // Duplicate registration

    expect(reg1).toBe(true);
    expect(reg2).toBe(true);
    expect(reg3).toBe(false);

    const standings = await getTournamentStandings(tournamentId);
    expect(standings.length).toBe(2);
    expect(standings.map((p) => p.username)).toContain('Alice');
    expect(standings.map((p) => p.username)).toContain('Bob');
  });

  it('should seat players and start the tournament', async () => {
    const tournamentId = await createTournament({ maxPlayers: 6, minPlayers: 2 });
    await registerPlayer(tournamentId, 1, 'Alice');
    await registerPlayer(tournamentId, 2, 'Bob');

    const started = await startTournament(tournamentId);
    expect(started).toBe(true);

    // Verify tournament status is running
    const { rows: tourneys } = await db.execute({
      sql: 'SELECT status FROM tournaments WHERE id = ?',
      args: [tournamentId],
    });
    expect(tourneys[0].status).toBe('running');

    // Verify players are seated in the players table
    const { rows: seatedPlayers } = await db.execute({
      sql: 'SELECT * FROM players WHERE table_id LIKE ?',
      args: [`${tournamentId}_table_%`],
    });
    expect(seatedPlayers.length).toBe(2);
  });

  it('should calculate time-based blinds', async () => {
    const tournamentId = await createTournament({
      blindLevels: [
        { level: 1, smallBlind: 10, bigBlind: 20, ante: 0, durationMinutes: 5 },
        { level: 2, smallBlind: 20, bigBlind: 40, ante: 5, durationMinutes: 5 },
      ],
    });

    // Before starting, it should fallback to level 1
    const initialBlinds = await getTournamentBlinds(tournamentId);
    expect(initialBlinds?.level).toBe(1);
    expect(initialBlinds?.smallBlind).toBe(10);

    // Start the tournament
    await registerPlayer(tournamentId, 1, 'Alice');
    await registerPlayer(tournamentId, 2, 'Bob');
    await startTournament(tournamentId);

    // Right after start, should be level 1
    const startedBlinds = await getTournamentBlinds(tournamentId);
    expect(startedBlinds?.level).toBe(1);
    expect(startedBlinds?.nextLevelInSecs).toBeGreaterThan(290);

    // Mock started_at to 6 minutes ago to advance to level 2
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await db.execute({
      sql: 'UPDATE tournaments SET started_at = ? WHERE id = ?',
      args: [sixMinutesAgo, tournamentId],
    });

    const level2Blinds = await getTournamentBlinds(tournamentId);
    expect(level2Blinds?.level).toBe(2);
    expect(level2Blinds?.smallBlind).toBe(20);
    expect(level2Blinds?.ante).toBe(5);
  });

  it('should balance tables and break tables correctly', async () => {
    const tournamentId = await createTournament({ maxPlayers: 12 });
    const p1 = { fid: 1, name: 'P1' };
    const p2 = { fid: 2, name: 'P2' };
    const p3 = { fid: 3, name: 'P3' };
    const p4 = { fid: 4, name: 'P4' };
    const p5 = { fid: 5, name: 'P5' };
    const p6 = { fid: 6, name: 'P6' };
    const p7 = { fid: 7, name: 'P7' };

    const players = [p1, p2, p3, p4, p5, p6, p7];
    for (const p of players) {
      await registerPlayer(tournamentId, p.fid, p.name);
    }

    // Start tournament (should distribute 7 players across 2 tables: 4 on Table 1, 3 on Table 2)
    await startTournament(tournamentId);

    const { rows: table1Players } = await db.execute({
      sql: 'SELECT fid FROM players WHERE table_id = ?',
      args: [`${tournamentId}_table_0`],
    });
    const { rows: table2Players } = await db.execute({
      sql: 'SELECT fid FROM players WHERE table_id = ?',
      args: [`${tournamentId}_table_1`],
    });

    expect(table1Players.length).toBe(4);
    expect(table2Players.length).toBe(3);

    // Mock player 1 busting (set stack to 0)
    await db.execute({
      sql: 'UPDATE players SET stack_size = 0 WHERE fid = ?',
      args: [1],
    });

    // Run table balancing
    await balanceTables(tournamentId);

    // Player 1 should be eliminated, 6 active players remain
    // 6 players can fit on 1 table, so table_1 should be broken and all 6 players moved to table_0!
    const { rows: activeStanding } = await db.execute({
      sql: 'SELECT * FROM tournament_players WHERE tournament_id = ? AND fid = ?',
      args: [tournamentId, 1],
    });
    expect(activeStanding[0].status).toBe('eliminated');

    const { rows: table1PlayersAfter } = await db.execute({
      sql: 'SELECT fid FROM players WHERE table_id = ?',
      args: [`${tournamentId}_table_0`],
    });
    const { rows: table2PlayersAfter } = await db.execute({
      sql: 'SELECT fid FROM players WHERE table_id = ?',
      args: [`${tournamentId}_table_1`],
    });

    const t0Count = table1PlayersAfter.length;
    const t1Count = table2PlayersAfter.length;
    expect([0, 6]).toContain(t0Count);
    expect([0, 6]).toContain(t1Count);
    expect(t0Count + t1Count).toBe(6);

    const brokenTableId = t0Count === 0 ? 0 : 1;
    const { rows: brokenTable } = await db.execute({
      sql: 'SELECT status FROM tables WHERE id = ?',
      args: [`${tournamentId}_table_${brokenTableId}`],
    });
    expect(brokenTable[0].status).toBe('broken');
  });
});
