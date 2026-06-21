// IPC Handlers — bridges Electron main ↔ renderer for all services
import { ipcMain, dialog } from 'electron';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { initDatabase, sqlite } from './db/index';
import { TherapyRexEngine } from './services/therapyRex';
import { parseHandHistory, type ParsedHand } from './services/handParser';
import { CloudSyncManager } from './services/cloudSync';
import { HHPathManager } from './services/hhPaths';
import { DriveHud2Sync } from './services/driveHud2Sync';

let therapyRex: TherapyRexEngine;
let cloudSync: CloudSyncManager;
export let hhPathManager: HHPathManager;
export let dh2Sync: DriveHud2Sync | null = null;
let dbReady = false;

const DEFAULT_HERO_NAME = 'jdwalka';
let _heroName: string = DEFAULT_HERO_NAME;

export function getHeroName(): string { return _heroName; }

function setHeroName(name: string) {
  _heroName = name || DEFAULT_HERO_NAME;
  try {
    const { app } = require('electron');
    const path = require('path');
    const fs = require('fs');
    const settingsPath = path.join(app.getPath('userData'), 'app-settings.json');
    const existing = fs.existsSync(settingsPath)
      ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      : {};
    fs.writeFileSync(settingsPath, JSON.stringify({ ...existing, heroName: _heroName }, null, 2));
  } catch (_) {}
}

function loadHeroName() {
  try {
    const { app } = require('electron');
    const path = require('path');
    const fs = require('fs');
    const settingsPath = path.join(app.getPath('userData'), 'app-settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (data.heroName) _heroName = data.heroName;
    }
  } catch (_) {}
}

export function registerIpcHandlers() {
  loadHeroName();
  therapyRex = new TherapyRexEngine();
  cloudSync = new CloudSyncManager();
  hhPathManager = new HHPathManager();

  try {
    initDatabase();
    dbReady = true;
  } catch (e) {
    console.error('[IPC] DB init failed:', e);
  }

  // ─── Hand Database ───────────────────────────────────────

  ipcMain.handle('db:getHands', (_e, { limit = 100, offset = 0, gameType, site } = {}) => {
    if (!dbReady) return [];
    let sql = 'SELECT * FROM hands';
    const conditions: string[] = [];
    const params: any[] = [];
    if (gameType) { conditions.push('game_type = ?'); params.push(gameType); }
    if (site) { conditions.push('site = ?'); params.push(site); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return sqlite.prepare(sql).all(...params);
  });

  ipcMain.handle('db:getHandById', (_e, id: string) => {
    if (!dbReady) return null;
    const hand = sqlite.prepare('SELECT * FROM hands WHERE id = ?').get(id);
    const actions = sqlite.prepare('SELECT * FROM actions WHERE hand_id = ? ORDER BY id').all(id);
    return { hand, actions };
  });

  ipcMain.handle('db:getSessions', (_e, { limit = 50 } = {}) => {
    if (!dbReady) return [];
    return sqlite.prepare('SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?').all(limit);
  });

  ipcMain.handle('db:getSessionHands', (_e, sessionId: string) => {
    if (!dbReady) return [];
    return sqlite.prepare('SELECT * FROM hands WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
  });

  ipcMain.handle('db:getStats', () => {
    if (!dbReady) return null;
    const totalHands = sqlite.prepare('SELECT COUNT(*) as count FROM hands').get() as any;
    const totalWon = sqlite.prepare('SELECT SUM(net_amount) as total FROM hands').get() as any;
    const gameTypes = sqlite.prepare('SELECT game_type, COUNT(*) as count FROM hands GROUP BY game_type').all();
    const recentResults = sqlite.prepare(
      'SELECT net_amount, timestamp, game_type, stakes FROM hands ORDER BY timestamp DESC LIMIT 200'
    ).all();
    return {
      totalHands: totalHands?.count || 0,
      totalWon: totalWon?.total || 0,
      gameTypes,
      recentResults
    };
  });

  ipcMain.handle('db:importParsedHands', (_e, hands: ParsedHand[]) => {
    if (!dbReady) return { imported: 0 };
    let imported = 0;

    const insertHand = sqlite.prepare(`
      INSERT OR IGNORE INTO hands (id, session_id, site, game_type, stakes, timestamp, board, hero_cards, hero_name, pot_size, won_pot, net_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAction = sqlite.prepare(`
      INSERT INTO actions (hand_id, player_name, action_type, amount, street)
      VALUES (?, ?, ?, ?, ?)
    `);

    const importMany = sqlite.transaction((hands: ParsedHand[]) => {
      for (const h of hands) {
        const ts = new Date(h.timestamp).getTime();
        const result = insertHand.run(
          h.id, null, h.site, h.gameType, h.stakes, ts,
          h.board.join(','), h.heroCards.join(','), h.heroName || null,
          Math.round(h.potSize * 100),
          h.heroWon ? 1 : 0, Math.round(h.heroNetAmount * 100)
        );
        if (result.changes > 0) {
          imported++;
          for (const a of h.actions) {
            insertAction.run(h.id, a.playerName, a.type, Math.round((a.amount || 0) * 100), a.street);
          }
        }
      }
    });

    importMany(hands);
    return { imported };
  });

  // ─── Therapy Rex (Session Review) ────────────────────────

  ipcMain.handle('rex:analyzeSession', async (_e, sessionId: string) => {
    if (!dbReady) return null;
    const hands = sqlite.prepare('SELECT * FROM hands WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
    if (hands.length === 0) {
      // Fallback: analyze last N hands
      const recentHands = sqlite.prepare('SELECT * FROM hands ORDER BY timestamp DESC LIMIT 50').all() as any[];
      const mapped = recentHands.map(h => ({
        amt_won: (h.net_amount || 0) / 100,
        date_played: new Date(h.timestamp).toISOString(),
        flg_vpip: true, flg_pfr: false, flg_saw_f: true, flg_won_hand: h.won_pot === 1
      }));
      const analysis = await therapyRex.analyzeSession({ id_session: 'recent', hands: mapped, duration: 120 });
      return therapyRex.generateSessionDebrief(analysis);
    }
    const mapped = hands.map((h: any) => ({
      amt_won: (h.net_amount || 0) / 100,
      date_played: new Date(h.timestamp).toISOString(),
      flg_vpip: true, flg_pfr: false, flg_saw_f: true, flg_won_hand: h.won_pot === 1
    }));
    const first = hands[0] as any;
    const last = hands[hands.length - 1] as any;
    const duration = Math.round((last.timestamp - first.timestamp) / 60000);
    const analysis = await therapyRex.analyzeSession({ id_session: sessionId, hands: mapped, duration });
    return therapyRex.generateSessionDebrief(analysis);
  });

  ipcMain.handle('rex:analyzeRecentHands', async (_e, count: number = 50) => {
    if (!dbReady) return null;
    const hands = sqlite.prepare('SELECT * FROM hands ORDER BY timestamp DESC LIMIT ?').all(count) as any[];
    const mapped = hands.reverse().map((h: any) => ({
      amt_won: (h.net_amount || 0) / 100,
      date_played: new Date(h.timestamp).toISOString(),
      flg_vpip: true, flg_pfr: false, flg_saw_f: true, flg_won_hand: h.won_pot === 1
    }));
    const duration = hands.length > 1
      ? Math.round(((hands[hands.length - 1] as any).timestamp - (hands[0] as any).timestamp) / 60000)
      : 60;
    const analysis = await therapyRex.analyzeSession({ id_session: 'recent', hands: mapped, duration });
    return therapyRex.generateSessionDebrief(analysis);
  });

  // ─── Cloud Sync ──────────────────────────────────────────

  ipcMain.handle('cloud:getTargets', () => cloudSync.getTargets());

  ipcMain.handle('cloud:addTarget', (_e, target) => cloudSync.addTarget(target));

  ipcMain.handle('cloud:updateTarget', (_e, id: string, updates: any) => cloudSync.updateTarget(id, updates));

  ipcMain.handle('cloud:removeTarget', (_e, id: string) => cloudSync.removeTarget(id));

  ipcMain.handle('cloud:detectFolders', () => cloudSync.detectCloudFolders());

  ipcMain.handle('cloud:syncHandText', (_e, text: string, site: string) => {
    return cloudSync.syncHandText(text, site);
  });

  // ─── Hand Parsing ────────────────────────────────────────

  ipcMain.handle('parser:parseText', (_e, rawText: string, site: string) => {
    return parseHandHistory(rawText, site);
  });

  ipcMain.handle('parser:importFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Hand History File',
      filters: [
        { name: 'Hand Histories', extensions: ['txt', 'xml'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || result.filePaths.length === 0) return { imported: 0 };

    const allHands: ParsedHand[] = [];
    for (const fp of result.filePaths) {
      const content = (await import('fs')).readFileSync(fp, 'utf8');
      const hands = parseHandHistory(content, 'DriveHUD2');
      allHands.push(...hands);
    }
    return allHands;
  });

  // ─── Settings / Misc ────────────────────────────────────

  ipcMain.handle('app:getDriveHudPath', () => {
    const appData = process.env.APPDATA || '';
    return require('path').join(appData, 'DriveHUD 2', 'ProcessedData');
  });

  ipcMain.handle('app:getVersion', () => {
    return require('electron').app.getVersion();
  });

  ipcMain.handle('app:getHeroName', () => {
    return getHeroName();
  });

  ipcMain.handle('app:setHeroName', (_e, name: string) => {
    setHeroName(name.trim());
    return true;
  });

  // ─── Leak Detection ──────────────────────────────────────

  ipcMain.handle('db:getLeakStats', (_e, { limit = 500 } = {}) => {
    if (!dbReady) return null;
    const total = (sqlite.prepare('SELECT COUNT(*) as c FROM hands WHERE hero_name IS NOT NULL').get() as any)?.c || 0;
    if (total === 0) return { vpip: 0, pfr: 0, threeBet: 0, af: 0, wtsd: 0, wsd: 0, riverCall: 0, winRate: 0, bb100: 0, totalHands: 0 };

    const vpip = (sqlite.prepare(`
      SELECT COUNT(DISTINCT a.hand_id) as c FROM actions a
      INNER JOIN hands h ON h.id = a.hand_id AND h.hero_name = a.player_name
      WHERE a.street = 'Preflop' AND a.action_type IN ('call','raise','allin','bet')
      LIMIT ?
    `).get(limit) as any)?.c || 0;

    const pfr = (sqlite.prepare(`
      SELECT COUNT(DISTINCT a.hand_id) as c FROM actions a
      INNER JOIN hands h ON h.id = a.hand_id AND h.hero_name = a.player_name
      WHERE a.street = 'Preflop' AND a.action_type IN ('raise','allin')
      LIMIT ?
    `).get(limit) as any)?.c || 0;

    const threeBet = (sqlite.prepare(`
      SELECT COUNT(DISTINCT hero_raise.hand_id) as c FROM actions hero_raise
      INNER JOIN hands h ON h.id = hero_raise.hand_id AND h.hero_name = hero_raise.player_name
      INNER JOIN actions opp_raise ON opp_raise.hand_id = hero_raise.hand_id
        AND opp_raise.player_name != hero_raise.player_name
        AND opp_raise.street = 'Preflop' AND opp_raise.action_type IN ('raise','allin')
        AND opp_raise.id < hero_raise.id
      WHERE hero_raise.street = 'Preflop' AND hero_raise.action_type IN ('raise','allin')
    `).get() as any)?.c || 0;

    const sawFlop = (sqlite.prepare(`
      SELECT COUNT(DISTINCT a.hand_id) as c FROM actions a
      INNER JOIN hands h ON h.id = a.hand_id AND h.hero_name = a.player_name
      WHERE a.street IN ('Flop','Turn','River','Showdown')
    `).get() as any)?.c || 0;

    const atShowdown = (sqlite.prepare(`
      SELECT COUNT(DISTINCT a.hand_id) as c FROM actions a
      INNER JOIN hands h ON h.id = a.hand_id AND h.hero_name = a.player_name
      WHERE a.street = 'Showdown'
    `).get() as any)?.c || 0;

    const wonShowdown = (sqlite.prepare(`
      SELECT COUNT(*) as c FROM hands h
      WHERE h.hero_name IS NOT NULL AND h.won_pot = 1
        AND h.id IN (
          SELECT DISTINCT a.hand_id FROM actions a
          INNER JOIN hands h2 ON h2.id = a.hand_id AND h2.hero_name = a.player_name
          WHERE a.street = 'Showdown'
        )
    `).get() as any)?.c || 0;

    const betsRaises = (sqlite.prepare(`
      SELECT COUNT(*) as c FROM actions a
      INNER JOIN hands h ON h.id = a.hand_id AND h.hero_name = a.player_name
      WHERE a.action_type IN ('bet','raise','allin')
    `).get() as any)?.c || 0;

    const calls = (sqlite.prepare(`
      SELECT COUNT(*) as c FROM actions a
      INNER JOIN hands h ON h.id = a.hand_id AND h.hero_name = a.player_name
      WHERE a.action_type = 'call'
    `).get() as any)?.c || 0;

    const riverCalls = (sqlite.prepare(`
      SELECT COUNT(*) as c FROM actions a
      INNER JOIN hands h ON h.id = a.hand_id AND h.hero_name = a.player_name
      WHERE a.street = 'River' AND a.action_type = 'call'
    `).get() as any)?.c || 0;

    const riverFacing = (sqlite.prepare(`
      SELECT COUNT(DISTINCT a.hand_id) as c FROM actions a
      INNER JOIN hands h ON h.id = a.hand_id AND h.hero_name = a.player_name
      WHERE a.street = 'River'
    `).get() as any)?.c || 0;

    const wins = (sqlite.prepare('SELECT COUNT(*) as c FROM hands WHERE hero_name IS NOT NULL AND net_amount > 0').get() as any)?.c || 0;
    const totalNet = (sqlite.prepare('SELECT SUM(net_amount) as s FROM hands WHERE hero_name IS NOT NULL').get() as any)?.s || 0;
    const avgStakes = (sqlite.prepare("SELECT AVG(CAST(SUBSTR(stakes, INSTR(stakes,'/')+1) AS REAL)) as s FROM hands WHERE hero_name IS NOT NULL AND stakes != 'unknown'").get() as any)?.s || 1;
    const bb100 = total > 0 ? ((totalNet / 100) / (total / 100)) * (100 / (avgStakes || 1)) : 0;

    return {
      vpip: total > 0 ? (vpip / total) * 100 : 0,
      pfr: total > 0 ? (pfr / total) * 100 : 0,
      threeBet: total > 0 ? (threeBet / total) * 100 : 0,
      af: calls > 0 ? betsRaises / calls : betsRaises,
      wtsd: sawFlop > 0 ? (atShowdown / sawFlop) * 100 : 0,
      wsd: atShowdown > 0 ? (wonShowdown / atShowdown) * 100 : 0,
      riverCall: riverFacing > 0 ? (riverCalls / riverFacing) * 100 : 0,
      winRate: total > 0 ? wins / total : 0,
      bb100: Math.round(bb100 * 10) / 10,
      totalHands: total,
    };
  });

  ipcMain.handle('db:getTiltFlags', (_e, { limit = 200 } = {}) => {
    if (!dbReady) return [];
    const hands = sqlite.prepare(
      'SELECT id, net_amount, timestamp FROM hands WHERE hero_name IS NOT NULL ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as any[];
    if (hands.length === 0) return [];

    const flags: any[] = [];
    let lossStreak = 0;

    for (let i = hands.length - 1; i >= 0; i--) {
      const h = hands[i];
      const net = h.net_amount / 100;
      if (net < 0) {
        lossStreak++;
        if (lossStreak === 3) {
          flags.push({ type: 'loss_streak', severity: 'medium', handIndex: i,
            description: `3+ losing hands in a row at hand #${i + 1}` });
        }
        if (net < -50) {
          flags.push({ type: 'bad_beat', severity: 'high', handIndex: i,
            description: `Large loss of $${Math.abs(net).toFixed(2)} on hand #${i + 1}` });
        }
      } else {
        lossStreak = 0;
      }

      if (i < hands.length - 1) {
        const prev = hands[i + 1];
        const timeDiff = Math.abs(h.timestamp - prev.timestamp) / 60000;
        if (timeDiff < 0.5 && timeDiff >= 0) {
          flags.push({ type: 'rapid_play', severity: 'low', handIndex: i,
            description: `Very fast hand pace near hand #${i + 1}` });
        }
      }
    }

    // Check for VPIP spike (last 20 vs overall)
    const recentVpip = (sqlite.prepare(`
      SELECT COUNT(DISTINCT a.hand_id) as c, COUNT(DISTINCT h.id) as total
      FROM hands h LEFT JOIN actions a ON a.hand_id = h.id
        AND h.hero_name = a.player_name AND a.street = 'Preflop'
        AND a.action_type IN ('call','raise','allin','bet')
      WHERE h.hero_name IS NOT NULL ORDER BY h.timestamp DESC LIMIT 20
    `).get() as any);
    const allVpip = (sqlite.prepare(`
      SELECT COUNT(DISTINCT a.hand_id) as c, COUNT(DISTINCT h.id) as total
      FROM hands h LEFT JOIN actions a ON a.hand_id = h.id
        AND h.hero_name = a.player_name AND a.street = 'Preflop'
        AND a.action_type IN ('call','raise','allin','bet')
      WHERE h.hero_name IS NOT NULL
    `).get() as any);

    if (recentVpip && allVpip && recentVpip.total > 0 && allVpip.total > 20) {
      const recentRate = recentVpip.c / recentVpip.total;
      const overallRate = allVpip.c / allVpip.total;
      if (recentRate > overallRate * 1.4) {
        flags.push({ type: 'vpip_spike', severity: 'medium',
          description: `Recent VPIP ${(recentRate * 100).toFixed(0)}% vs overall ${(overallRate * 100).toFixed(0)}% — possible tilt loosening` });
      }
    }

    return flags.slice(0, 20);
  });

  ipcMain.handle('db:getLeaks', () => {
    if (!dbReady) return [];
    const stats = sqlite.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN net_amount > 0 THEN 1 ELSE 0 END) as wins,
        AVG(net_amount) as avg_net
      FROM hands WHERE hero_name IS NOT NULL
    `).get() as any;
    if (!stats || stats.total === 0) return [];

    const leakStats: any = {};
    const stmts: Record<string, string> = {
      vpip: `SELECT CAST(COUNT(DISTINCT a.hand_id) AS REAL) / COUNT(DISTINCT h.id) * 100 as v
             FROM hands h LEFT JOIN actions a ON a.hand_id=h.id AND h.hero_name=a.player_name
               AND a.street='Preflop' AND a.action_type IN ('call','raise','allin','bet')
             WHERE h.hero_name IS NOT NULL`,
      pfr: `SELECT CAST(COUNT(DISTINCT a.hand_id) AS REAL) / COUNT(DISTINCT h.id) * 100 as v
            FROM hands h LEFT JOIN actions a ON a.hand_id=h.id AND h.hero_name=a.player_name
              AND a.street='Preflop' AND a.action_type IN ('raise','allin')
            WHERE h.hero_name IS NOT NULL`,
    };

    for (const [key, sql] of Object.entries(stmts)) {
      leakStats[key] = ((sqlite.prepare(sql).get() as any)?.v) || 0;
    }

    const leaks: any[] = [];
    const ranges: Record<string, { label: string; min: number; max: number; advice: string }> = {
      vpip: { label: 'VPIP', min: 18, max: 28, advice: 'Tighten starting hand selection. Only play strong hands from all positions.' },
      pfr: { label: 'PFR', min: 14, max: 22, advice: 'Raise more with your playable hands instead of calling. Build the pot with strong holdings.' },
    };

    for (const [key, range] of Object.entries(ranges)) {
      const val = leakStats[key] || 0;
      if (val < range.min || val > range.max) {
        const dist = val < range.min ? range.min - val : val - range.max;
        const severity = dist > 12 ? 'high' : dist > 6 ? 'medium' : 'low';
        leaks.push({
          stat: range.label,
          value: val,
          severity,
          advice: range.advice,
          optimalRange: [range.min, range.max],
        });
      }
    }

    // Aggression factor check
    const betsRaises = (sqlite.prepare(`
      SELECT COUNT(*) as c FROM actions a INNER JOIN hands h ON h.id=a.hand_id AND h.hero_name=a.player_name
      WHERE a.action_type IN ('bet','raise','allin')
    `).get() as any)?.c || 0;
    const calls = (sqlite.prepare(`
      SELECT COUNT(*) as c FROM actions a INNER JOIN hands h ON h.id=a.hand_id AND h.hero_name=a.player_name
      WHERE a.action_type = 'call'
    `).get() as any)?.c || 0;
    const af = calls > 0 ? betsRaises / calls : 0;
    if (af > 0 && (af < 1.5 || af > 4.5)) {
      const severity = (af < 1.0 || af > 6.0) ? 'high' : 'medium';
      leaks.push({
        stat: 'Aggression Factor',
        value: af,
        severity,
        advice: af < 1.5 ? 'Play more aggressively — bet and raise instead of calling.' : 'Tone down aggression — you may be bluffing too much.',
        optimalRange: [1.5, 4.5],
      });
    }

    return leaks;
  });

  // ─── Summaries ──────────────────────────────────────────

  ipcMain.handle('db:getSummaries', (_e, { period = 'daily', limit = 2000 } = {}) => {
    if (!dbReady) return [];

    const groupFmt = period === 'monthly'
      ? "strftime('%Y-%m', datetime(timestamp/1000, 'unixepoch'))"
      : period === 'weekly'
      ? "strftime('%Y-W%W', datetime(timestamp/1000, 'unixepoch'))"
      : "strftime('%Y-%m-%d', datetime(timestamp/1000, 'unixepoch'))";

    const rows = sqlite.prepare(`
      SELECT
        ${groupFmt} as period,
        COUNT(*) as hand_count,
        SUM(net_amount) as total_won,
        SUM(CASE WHEN net_amount > 0 THEN 1 ELSE 0 END) as wins
      FROM hands
      GROUP BY ${groupFmt}
      ORDER BY period DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(r => ({
      period: r.period,
      handCount: r.hand_count,
      tiltFlags: [],
      stats: { totalHands: r.hand_count, totalWon: r.total_won || 0 },
    }));
  });

  // ─── Gameplay Analysis ───────────────────────────────────

  ipcMain.handle('db:getGameplayAnalysis', () => {
    if (!dbReady) return null;

    // Starting hand performance
    const startingHands = sqlite.prepare(`
      SELECT
        hero_cards,
        COUNT(*) as hands_played,
        SUM(net_amount) as total_net,
        ROUND(AVG(CAST(net_amount AS REAL)), 1) as avg_net,
        SUM(CASE WHEN net_amount > 0 THEN 1 ELSE 0 END) as wins
      FROM hands
      WHERE hero_cards IS NOT NULL AND hero_cards != '' AND LENGTH(hero_cards) > 1
      GROUP BY hero_cards
      HAVING COUNT(*) >= 2
      ORDER BY total_net DESC
    `).all() as any[];

    // Action frequency by street (hero only)
    const actionFreq = sqlite.prepare(`
      SELECT
        a.street,
        a.action_type,
        COUNT(*) as cnt
      FROM actions a
      INNER JOIN hands h ON h.id = a.hand_id AND h.hero_name = a.player_name
      WHERE h.hero_name IS NOT NULL
      GROUP BY a.street, a.action_type
      ORDER BY a.street, cnt DESC
    `).all() as any[];

    // P&L by game type
    const byGameType = sqlite.prepare(`
      SELECT game_type, SUM(net_amount) as total_net, COUNT(*) as hands,
        ROUND(AVG(CAST(net_amount AS REAL)), 1) as avg_net
      FROM hands GROUP BY game_type ORDER BY total_net DESC
    `).all() as any[];

    // P&L by stakes
    const byStakes = sqlite.prepare(`
      SELECT stakes, SUM(net_amount) as total_net, COUNT(*) as hands,
        ROUND(AVG(CAST(net_amount AS REAL)), 1) as avg_net
      FROM hands GROUP BY stakes ORDER BY hands DESC LIMIT 20
    `).all() as any[];

    // Pot size win analysis
    const potAnalysis = sqlite.prepare(`
      SELECT
        CASE
          WHEN pot_size < 1000 THEN 'Micro (<$10)'
          WHEN pot_size < 5000 THEN 'Small ($10-$50)'
          WHEN pot_size < 20000 THEN 'Medium ($50-$200)'
          ELSE 'Large (>$200)'
        END as pot_category,
        COUNT(*) as hands,
        SUM(CASE WHEN won_pot = 1 THEN 1 ELSE 0 END) as wins,
        ROUND(AVG(CAST(net_amount AS REAL)) / 100.0, 2) as avg_net_dollars
      FROM hands
      GROUP BY pot_category
    `).all() as any[];

    // Results by day of week
    const byDayOfWeek = sqlite.prepare(`
      SELECT
        CASE strftime('%w', datetime(timestamp/1000, 'unixepoch'))
          WHEN '0' THEN 'Sun' WHEN '1' THEN 'Mon' WHEN '2' THEN 'Tue'
          WHEN '3' THEN 'Wed' WHEN '4' THEN 'Thu' WHEN '5' THEN 'Fri'
          ELSE 'Sat' END as day,
        COUNT(*) as hands,
        SUM(net_amount) as total_net
      FROM hands WHERE hero_name IS NOT NULL
      GROUP BY strftime('%w', datetime(timestamp/1000, 'unixepoch'))
      ORDER BY strftime('%w', datetime(timestamp/1000, 'unixepoch'))
    `).all() as any[];

    return { startingHands, actionFreq, byGameType, byStakes, potAnalysis, byDayOfWeek };
  });

  // ─── Hand Tags ───────────────────────────────────────────

  ipcMain.handle('db:addTag', (_e, handId: string, tag: string) => {
    if (!dbReady) return false;
    try {
      sqlite.prepare('INSERT OR IGNORE INTO hand_tags (hand_id, tag) VALUES (?, ?)').run(handId, tag);
      return true;
    } catch { return false; }
  });

  ipcMain.handle('db:removeTag', (_e, handId: string, tag: string) => {
    if (!dbReady) return false;
    sqlite.prepare('DELETE FROM hand_tags WHERE hand_id = ? AND tag = ?').run(handId, tag);
    return true;
  });

  ipcMain.handle('db:getTagsForHand', (_e, handId: string) => {
    if (!dbReady) return [];
    return (sqlite.prepare('SELECT tag FROM hand_tags WHERE hand_id = ? ORDER BY tag').all(handId) as any[]).map(r => r.tag);
  });

  ipcMain.handle('db:getAllTags', () => {
    if (!dbReady) return [];
    return (sqlite.prepare('SELECT DISTINCT tag FROM hand_tags ORDER BY tag').all() as any[]).map(r => r.tag);
  });

  ipcMain.handle('db:getHandsByTag', (_e, tag: string) => {
    if (!dbReady) return [];
    return sqlite.prepare(`
      SELECT h.* FROM hands h INNER JOIN hand_tags t ON t.hand_id = h.id
      WHERE t.tag = ? ORDER BY h.timestamp DESC LIMIT 200
    `).all(tag);
  });

  // ─── HH Path Management ──────────────────────────────────

  ipcMain.handle('app:getHHClients', () => {
    return hhPathManager.getKnownClients();
  });

  ipcMain.handle('app:getActiveHHPaths', () => {
    return hhPathManager.getActivePaths();
  });

  ipcMain.handle('app:addCustomHHPath', (_e, p: string, site: string) => {
    return hhPathManager.addCustomPath(p, site);
  });

  ipcMain.handle('app:removeCustomHHPath', (_e, p: string) => {
    return hhPathManager.removeCustomPath(p);
  });

  ipcMain.handle('app:browseFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Hand History Folder',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ─── Backup ──────────────────────────────────────────────

  ipcMain.handle('app:getBackupDir', () => {
    return path.join(app.getPath('documents'), 'PokerTherapist', 'Backups');
  });

  ipcMain.handle('app:getBackups', () => {
    const backupDir = path.join(app.getPath('documents'), 'PokerTherapist', 'Backups');
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.sqlite') || f.endsWith('.db'))
      .map(f => {
        const stat = fs.statSync(path.join(backupDir, f));
        return {
          name: f,
          date: stat.mtime.toISOString(),
          sizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  ipcMain.handle('app:runBackup', () => {
    try {
      const backupDir = path.join(app.getPath('documents'), 'PokerTherapist', 'Backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const srcDb = path.join(app.getPath('userData'), 'poker-tracker.sqlite');
      if (!fs.existsSync(srcDb)) return { success: false, files: [] };
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const dest = path.join(backupDir, `poker-tracker-${stamp}.sqlite`);
      fs.copyFileSync(srcDb, dest);
      return { success: true, files: [dest] };
    } catch (e) {
      return { success: false, files: [], error: String(e) };
    }
  });

  // ─── DriveHUD 2 Sync ─────────────────────────────────────

  ipcMain.handle('dh2:getStatus', () => {
    return dh2Sync ? dh2Sync.getStatus() : null;
  });

  ipcMain.handle('dh2:syncNow', () => {
    if (!dh2Sync) return { newHands: 0, newTournaments: 0 };
    return dh2Sync.sync();
  });

  ipcMain.handle('dh2:getPlayers', () => {
    return dh2Sync ? dh2Sync.getPlayers() : [];
  });

  ipcMain.handle('dh2:getTournaments', (_e, limit?: number) => {
    return dh2Sync ? dh2Sync.getTournaments(limit) : [];
  });

  ipcMain.handle('dh2:pushHandNote', (_e, handNumber: string, note: string, siteId?: number) => {
    return dh2Sync ? dh2Sync.pushHandNote(handNumber, note, siteId) : false;
  });

  ipcMain.handle('dh2:pushPlayerNote', (_e, playerName: string, note: string, siteId?: number) => {
    return dh2Sync ? dh2Sync.pushPlayerNote(playerName, note, siteId) : false;
  });

  ipcMain.handle('dh2:getHandNotes', () => {
    return dh2Sync ? dh2Sync.getHandNotes() : [];
  });

  ipcMain.handle('dh2:getPlayerNotes', () => {
    return dh2Sync ? dh2Sync.getPlayerNotes() : [];
  });

  ipcMain.handle('dh2:resetSync', () => {
    if (dh2Sync) { dh2Sync.resetSync(); return true; }
    return false;
  });

  ipcMain.handle('dh2:setPollInterval', (_e, ms: number) => {
    if (dh2Sync) { dh2Sync.setPollInterval(ms); return true; }
    return false;
  });
}
