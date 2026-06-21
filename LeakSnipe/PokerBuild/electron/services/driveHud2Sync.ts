// DriveHUD2 Database Sync Service
// Polls DH2's drivehud.db for new hands and syncs them into our poker-tracker.sqlite
// Also supports two-way note/tag sync

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { parseDH2Xml, mapDH2SiteId, type ParsedHand } from './handParser';

export interface DH2SyncStatus {
  connected: boolean;
  dbPath: string;
  lastSyncTime: string | null;
  lastHandHistoryId: number;
  totalDH2Hands: number;
  totalDH2Tournaments: number;
  totalSynced: number;
  pollIntervalMs: number;
  running: boolean;
  error: string | null;
}

export interface DH2Player {
  playerId: number;
  playerName: string;
  siteId: number;
  siteName: string;
  cashHands: number;
  tournamentHands: number;
}

export interface DH2Tournament {
  tournamentNumber: string;
  siteId: number;
  siteName: string;
  buyIn: number;
  rake: number;
  winnings: number;
  endPosition: number;
  tournamentSize: number;
  firstHand: string;
  lastHand: string;
  gameType: number;
}

interface SyncState {
  lastHandHistoryId: number;
  lastTournamentSync: string;
}

export class DriveHud2Sync {
  private dh2Db: Database.Database | null = null;
  private localDb: Database.Database | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private dh2DbPath: string;
  private syncState: SyncState;
  private statePath: string;
  private running = false;
  private lastError: string | null = null;
  private heroName: string;
  private onNewHands: ((hands: ParsedHand[]) => void) | null = null;
  private onLog: (msg: string, type: 'info' | 'error') => void;

  constructor(opts?: {
    pollIntervalMs?: number;
    heroName?: string;
    onNewHands?: (hands: ParsedHand[]) => void;
    onLog?: (msg: string, type: 'info' | 'error') => void;
  }) {
    this.pollIntervalMs = opts?.pollIntervalMs || 5000;
    this.heroName = opts?.heroName || 'jdwalka';
    this.onNewHands = opts?.onNewHands || null;
    this.onLog = opts?.onLog || ((msg, type) => { if (type === 'error') console.error(msg); else console.log(msg); });

    // Determine DH2 DB path
    const roaming = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    this.dh2DbPath = path.join(roaming, 'DriveHUD 2', 'drivehud.db');

    // Sync state persisted to disk
    this.statePath = path.join(app.getPath('userData'), 'dh2-sync-state.json');
    this.syncState = this.loadState();
  }

  private loadState(): SyncState {
    try {
      if (fs.existsSync(this.statePath)) {
        return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      }
    } catch (_) {}
    return { lastHandHistoryId: 0, lastTournamentSync: '' };
  }

  private saveState() {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(this.syncState, null, 2), 'utf8');
    } catch (e) {
      this.onLog(`[DH2Sync] Failed to save state: ${e}`, 'error');
    }
  }

  /** Open DH2 database in read-only mode */
  private openDH2(): boolean {
    if (this.dh2Db) return true;
    if (!fs.existsSync(this.dh2DbPath)) {
      this.lastError = `DriveHUD 2 DB not found at ${this.dh2DbPath}`;
      this.onLog(`[DH2Sync] ${this.lastError}`, 'error');
      return false;
    }
    try {
      this.dh2Db = new Database(this.dh2DbPath, { readonly: true, fileMustExist: true });
      // Enable WAL reading for concurrent access while DH2 is running
      this.dh2Db.pragma('journal_mode = WAL');
      this.lastError = null;
      this.onLog(`[DH2Sync] Opened DH2 database: ${this.dh2DbPath}`, 'info');
      return true;
    } catch (e) {
      this.lastError = `Failed to open DH2 DB: ${e}`;
      this.onLog(`[DH2Sync] ${this.lastError}`, 'error');
      this.dh2Db = null;
      return false;
    }
  }

  /** Set reference to local poker-tracker DB */
  setLocalDb(db: Database.Database) {
    this.localDb = db;
    this.ensureLocalTables();
  }

  /** Ensure local DB has needed tables for DH2 sync tracking */
  private ensureLocalTables() {
    if (!this.localDb) return;
    this.localDb.exec(`
      CREATE TABLE IF NOT EXISTS dh2_sync_log (
        dh2_hand_history_id INTEGER PRIMARY KEY,
        local_hand_id TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tournaments (
        id TEXT PRIMARY KEY,
        tournament_number TEXT NOT NULL,
        site TEXT NOT NULL,
        buy_in REAL,
        rake REAL,
        winnings REAL,
        end_position INTEGER,
        tournament_size INTEGER,
        first_hand_time INTEGER,
        last_hand_time INTEGER,
        game_type TEXT,
        hero_name TEXT
      );
    `);
    // Migration: add hero_position to hands if missing
    try { this.localDb.exec('ALTER TABLE hands ADD COLUMN is_tournament INTEGER DEFAULT 0'); } catch (_) {}
    try { this.localDb.exec('ALTER TABLE hands ADD COLUMN tournament_id TEXT'); } catch (_) {}
  }

  /** Fetch new hand histories from DH2 since last sync */
  private fetchNewHands(): { id: number; handHistory: string; siteId: number; timestamp: string; tournamentNumber: string; gameType: number }[] {
    if (!this.dh2Db) return [];
    try {
      const rows = this.dh2Db.prepare(`
        SELECT HandHistoryId, HandHistory, PokerSiteId, HandHistoryTimestamp, TournamentNumber, GameType
        FROM HandHistories
        WHERE HandHistoryId > ?
        ORDER BY HandHistoryId ASC
        LIMIT 500
      `).all(this.syncState.lastHandHistoryId) as any[];
      return rows.map(r => ({
        id: r.HandHistoryId,
        handHistory: r.HandHistory,
        siteId: r.PokerSiteId,
        timestamp: r.HandHistoryTimestamp,
        tournamentNumber: r.TournamentNumber || '',
        gameType: r.GameType,
      }));
    } catch (e) {
      this.lastError = `Failed to fetch DH2 hands: ${e}`;
      this.onLog(`[DH2Sync] ${this.lastError}`, 'error');
      return [];
    }
  }

  /** Import fetched hands into local DB */
  private importHands(dh2Rows: ReturnType<typeof this.fetchNewHands>): ParsedHand[] {
    if (!this.localDb || dh2Rows.length === 0) return [];

    const insertHand = this.localDb.prepare(`
      INSERT OR IGNORE INTO hands
        (id, session_id, site, game_type, stakes, timestamp, board, hero_cards, hero_name, hero_position, pot_size, won_pot, net_amount, is_tournament, tournament_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAction = this.localDb.prepare(`
      INSERT INTO actions (hand_id, player_name, action_type, amount, street)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertSyncLog = this.localDb.prepare(`
      INSERT OR IGNORE INTO dh2_sync_log (dh2_hand_history_id, local_hand_id, synced_at)
      VALUES (?, ?, ?)
    `);

    const allParsed: ParsedHand[] = [];

    const importBatch = this.localDb.transaction(() => {
      for (const row of dh2Rows) {
        try {
          const isXml = row.handHistory.trimStart().startsWith('<?xml') || row.handHistory.includes('<HandHistory>');
          let parsedHands: ParsedHand[];

          if (isXml) {
            const hand = parseDH2Xml(row.handHistory, this.heroName);
            parsedHands = hand ? [hand] : [];
          } else {
            // Text format — use the existing text parser
            const { parseHandHistory } = require('./handParser');
            parsedHands = parseHandHistory(row.handHistory, mapDH2SiteId(row.siteId), this.heroName);
          }

          for (const h of parsedHands) {
            h.dh2HandHistoryId = row.id;
            if (row.tournamentNumber) {
              h.isTournament = true;
              h.tournamentId = row.tournamentNumber;
            }
            h.site = h.site || mapDH2SiteId(row.siteId);

            const ts = new Date(h.timestamp).getTime() || Date.now();
            const result = insertHand.run(
              h.id, null, h.site, h.gameType, h.stakes, ts,
              h.board.join(','), h.heroCards.join(','),
              h.heroName || null, null,
              Math.round(h.potSize * 100),
              h.heroWon ? 1 : 0,
              Math.round(h.heroNetAmount * 100),
              h.isTournament ? 1 : 0,
              h.tournamentId || null
            );

            if (result.changes > 0) {
              for (const a of h.actions) {
                insertAction.run(h.id, a.playerName, a.type, Math.round((a.amount || 0) * 100), a.street);
              }
            }

            insertSyncLog.run(row.id, h.id, new Date().toISOString());
            allParsed.push(h);
          }
        } catch (e) {
          this.onLog(`[DH2Sync] Failed to parse DH2 hand #${row.id}: ${e}`, 'error');
        }

        // Track highest synced ID
        if (row.id > this.syncState.lastHandHistoryId) {
          this.syncState.lastHandHistoryId = row.id;
        }
      }
    });

    importBatch();
    this.saveState();
    return allParsed;
  }

  /** Sync tournaments from DH2 */
  private syncTournaments() {
    if (!this.dh2Db || !this.localDb) return;
    try {
      const tournaments = this.dh2Db.prepare(`
        SELECT TournamentNumber, PokerSiteId, BuyIn, Rake, Winnings,
               PlayerEndPosition, TournamentSize, FirstHandTimestamp, LastHandTimestamp,
               GameType, PlayerId
        FROM Tournaments
        ORDER BY LastHandTimestamp DESC
      `).all() as any[];

      // Get hero player IDs
      const heroIds = this.dh2Db.prepare(`
        SELECT PlayerId FROM Players WHERE PlayerName IN (?, ?)
      `).all(this.heroName, 'JohnDaWalka') as any[];
      const heroPlayerIds = new Set(heroIds.map((r: any) => r.PlayerId));

      const upsert = this.localDb.prepare(`
        INSERT OR REPLACE INTO tournaments
          (id, tournament_number, site, buy_in, rake, winnings, end_position, tournament_size, first_hand_time, last_hand_time, game_type, hero_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const batch = this.localDb.transaction(() => {
        for (const t of tournaments) {
          if (!heroPlayerIds.has(t.PlayerId)) continue; // only sync hero's tournaments
          const siteStr = mapDH2SiteId(t.PokerSiteId);
          const id = `${t.TournamentNumber}-${t.PokerSiteId}-${t.PlayerId}`;
          upsert.run(
            id, t.TournamentNumber, siteStr,
            (t.BuyIn || 0) / 100, (t.Rake || 0) / 100, (t.Winnings || 0) / 100,
            t.PlayerEndPosition, t.TournamentSize,
            t.FirstHandTimestamp ? new Date(t.FirstHandTimestamp).getTime() : null,
            t.LastHandTimestamp ? new Date(t.LastHandTimestamp).getTime() : null,
            this.mapGameTypeId(t.GameType),
            this.heroName
          );
        }
      });
      batch();
    } catch (e) {
      this.onLog(`[DH2Sync] Tournament sync failed: ${e}`, 'error');
    }
  }

  private mapGameTypeId(id: number): string {
    // DH2 uses numeric game type IDs; common ones:
    const map: Record<number, string> = {
      1: 'NLHE', 2: 'PLO', 3: 'LHE', 4: 'PLO8', 5: 'PLHE',
      29: 'NLHE', 30: 'PLO',
    };
    return map[id] || 'NLHE';
  }

  /** Run a single sync cycle */
  sync(): { newHands: number; newTournaments: number } {
    if (!this.openDH2()) return { newHands: 0, newTournaments: 0 };

    const dh2Rows = this.fetchNewHands();
    const parsed = this.importHands(dh2Rows);

    if (parsed.length > 0) {
      this.onLog(`[DH2Sync] Imported ${parsed.length} new hand(s) from DriveHUD 2`, 'info');
      if (this.onNewHands) {
        this.onNewHands(parsed);
      }
    }

    // Sync tournaments periodically (every 30s worth of polls)
    this.syncTournaments();

    return { newHands: parsed.length, newTournaments: 0 };
  }

  /** Start polling */
  start() {
    if (this.running) return;
    this.running = true;
    this.onLog(`[DH2Sync] Starting poll every ${this.pollIntervalMs}ms`, 'info');

    // Initial sync
    try { this.sync(); } catch (e) { this.onLog(`[DH2Sync] Initial sync error: ${e}`, 'error'); }

    this.pollTimer = setInterval(() => {
      try { this.sync(); } catch (e) { this.onLog(`[DH2Sync] Poll error: ${e}`, 'error'); }
    }, this.pollIntervalMs);
  }

  /** Stop polling */
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.running = false;
    this.onLog('[DH2Sync] Stopped polling', 'info');
  }

  /** Close DH2 database connection */
  destroy() {
    this.stop();
    try { this.dh2Db?.close(); } catch (_) {}
    this.dh2Db = null;
  }

  /** Get current sync status */
  getStatus(): DH2SyncStatus {
    let totalDH2Hands = 0;
    let totalDH2Tournaments = 0;
    let totalSynced = 0;

    if (this.dh2Db) {
      try {
        totalDH2Hands = (this.dh2Db.prepare('SELECT COUNT(*) as c FROM HandHistories').get() as any)?.c || 0;
        totalDH2Tournaments = (this.dh2Db.prepare('SELECT COUNT(*) as c FROM Tournaments').get() as any)?.c || 0;
      } catch (_) {}
    }
    if (this.localDb) {
      try {
        totalSynced = (this.localDb.prepare('SELECT COUNT(*) as c FROM dh2_sync_log').get() as any)?.c || 0;
      } catch (_) {}
    }

    return {
      connected: !!this.dh2Db,
      dbPath: this.dh2DbPath,
      lastSyncTime: this.syncState.lastTournamentSync || null,
      lastHandHistoryId: this.syncState.lastHandHistoryId,
      totalDH2Hands,
      totalDH2Tournaments,
      totalSynced,
      pollIntervalMs: this.pollIntervalMs,
      running: this.running,
      error: this.lastError,
    };
  }

  /** Get players from DH2 */
  getPlayers(): DH2Player[] {
    if (!this.openDH2() || !this.dh2Db) return [];
    try {
      const rows = this.dh2Db.prepare(`
        SELECT PlayerId, PlayerName, PokerSiteId, CashHandsPlayed, TournamentHandsPlayed
        FROM Players ORDER BY CashHandsPlayed + TournamentHandsPlayed DESC
      `).all() as any[];
      return rows.map(r => ({
        playerId: r.PlayerId,
        playerName: r.PlayerName,
        siteId: r.PokerSiteId,
        siteName: mapDH2SiteId(r.PokerSiteId),
        cashHands: r.CashHandsPlayed || 0,
        tournamentHands: r.TournamentHandsPlayed || 0,
      }));
    } catch (_) { return []; }
  }

  /** Get tournaments from DH2 (hero only) */
  getTournaments(limit = 100): DH2Tournament[] {
    if (!this.openDH2() || !this.dh2Db) return [];
    try {
      const heroIds = this.dh2Db.prepare(`
        SELECT PlayerId FROM Players WHERE PlayerName IN (?, ?)
      `).all(this.heroName, 'JohnDaWalka') as any[];
      const heroPlayerIds = heroIds.map((r: any) => r.PlayerId);
      if (heroPlayerIds.length === 0) return [];

      const placeholders = heroPlayerIds.map(() => '?').join(',');
      const rows = this.dh2Db.prepare(`
        SELECT TournamentNumber, PokerSiteId, BuyIn, Rake, Winnings,
               PlayerEndPosition, TournamentSize, FirstHandTimestamp, LastHandTimestamp, GameType
        FROM Tournaments
        WHERE PlayerId IN (${placeholders})
        ORDER BY LastHandTimestamp DESC LIMIT ?
      `).all(...heroPlayerIds, limit) as any[];

      return rows.map(r => ({
        tournamentNumber: r.TournamentNumber,
        siteId: r.PokerSiteId,
        siteName: mapDH2SiteId(r.PokerSiteId),
        buyIn: (r.BuyIn || 0) / 100,
        rake: (r.Rake || 0) / 100,
        winnings: (r.Winnings || 0) / 100,
        endPosition: r.PlayerEndPosition,
        tournamentSize: r.TournamentSize,
        firstHand: r.FirstHandTimestamp || '',
        lastHand: r.LastHandTimestamp || '',
        gameType: r.GameType,
      }));
    } catch (_) { return []; }
  }

  // ─── Two-Way Sync: Push Notes/Tags to DH2 ────────────────────────

  /** Push a hand note to DH2's HandNotes table */
  pushHandNote(handNumber: string, note: string, pokerSiteId: number = 44): boolean {
    if (!this.dh2DbPath || !fs.existsSync(this.dh2DbPath)) return false;
    let writeDb: Database.Database | null = null;
    try {
      // Open a separate writable connection for pushing data
      writeDb = new Database(this.dh2DbPath, { fileMustExist: true });
      writeDb.pragma('journal_mode = WAL');

      const existing = writeDb.prepare(
        'SELECT HandNoteId FROM HandNotes WHERE HandNumber = ? AND PokerSiteId = ?'
      ).get(handNumber, pokerSiteId) as any;

      if (existing) {
        writeDb.prepare('UPDATE HandNotes SET Note = ? WHERE HandNoteId = ?').run(note, existing.HandNoteId);
      } else {
        writeDb.prepare(
          'INSERT INTO HandNotes (HandTag, Note, HandNumber, PokerSiteId) VALUES (?, ?, ?, ?)'
        ).run(0, note, handNumber, pokerSiteId);
      }
      this.onLog(`[DH2Sync] Pushed hand note for hand #${handNumber}`, 'info');
      return true;
    } catch (e) {
      this.onLog(`[DH2Sync] Failed to push hand note: ${e}`, 'error');
      return false;
    } finally {
      try { writeDb?.close(); } catch (_) {}
    }
  }

  /** Push a player note to DH2's PlayerNotes table */
  pushPlayerNote(playerName: string, note: string, pokerSiteId: number = 44): boolean {
    if (!this.dh2DbPath || !fs.existsSync(this.dh2DbPath)) return false;
    let writeDb: Database.Database | null = null;
    try {
      writeDb = new Database(this.dh2DbPath, { fileMustExist: true });
      writeDb.pragma('journal_mode = WAL');

      // Find player ID
      const player = writeDb.prepare(
        'SELECT PlayerId FROM Players WHERE PlayerName = ? AND PokerSiteId = ?'
      ).get(playerName, pokerSiteId) as any;
      if (!player) {
        this.onLog(`[DH2Sync] Player "${playerName}" not found in DH2 for site ${pokerSiteId}`, 'error');
        return false;
      }

      writeDb.prepare(
        'INSERT INTO PlayerNotes (PlayerId, Note, Timestamp, IsAutoNote, PokerSiteId) VALUES (?, ?, ?, ?, ?)'
      ).run(player.PlayerId, note, new Date().toISOString(), 0, pokerSiteId);

      this.onLog(`[DH2Sync] Pushed player note for "${playerName}"`, 'info');
      return true;
    } catch (e) {
      this.onLog(`[DH2Sync] Failed to push player note: ${e}`, 'error');
      return false;
    } finally {
      try { writeDb?.close(); } catch (_) {}
    }
  }

  /** Read DH2 hand notes (for initial import) */
  getHandNotes(): { handNumber: string; note: string; siteId: number }[] {
    if (!this.openDH2() || !this.dh2Db) return [];
    try {
      return (this.dh2Db.prepare(
        'SELECT HandNumber, Note, PokerSiteId FROM HandNotes WHERE Note IS NOT NULL AND Note != ""'
      ).all() as any[]).map(r => ({
        handNumber: r.HandNumber,
        note: r.Note,
        siteId: r.PokerSiteId,
      }));
    } catch (_) { return []; }
  }

  /** Read DH2 player notes */
  getPlayerNotes(): { playerName: string; note: string; siteId: number; timestamp: string }[] {
    if (!this.openDH2() || !this.dh2Db) return [];
    try {
      return (this.dh2Db.prepare(`
        SELECT p.PlayerName, n.Note, n.PokerSiteId, n.Timestamp
        FROM PlayerNotes n JOIN Players p ON p.PlayerId = n.PlayerId
        WHERE n.Note IS NOT NULL AND n.Note != ''
        ORDER BY n.Timestamp DESC
      `).all() as any[]).map(r => ({
        playerName: r.PlayerName,
        note: r.Note,
        siteId: r.PokerSiteId,
        timestamp: r.Timestamp,
      }));
    } catch (_) { return []; }
  }

  /** Update hero name */
  setHeroName(name: string) {
    this.heroName = name;
  }

  /** Update poll interval */
  setPollInterval(ms: number) {
    this.pollIntervalMs = ms;
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  /** Force a full re-sync by resetting the last synced ID */
  resetSync() {
    this.syncState.lastHandHistoryId = 0;
    this.syncState.lastTournamentSync = '';
    this.saveState();
    this.onLog('[DH2Sync] Sync state reset — next poll will import all hands', 'info');
  }
}
