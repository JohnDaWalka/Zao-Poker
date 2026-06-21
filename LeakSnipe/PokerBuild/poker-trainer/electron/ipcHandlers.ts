// IPC Handlers — bridges Electron main ↔ renderer for all services
import { ipcMain, dialog } from 'electron';
import { initDatabase, sqlite } from './db/index';
import { TherapyRexEngine } from './services/therapyRex';
import { parseHandHistory, type ParsedHand } from './services/handParser';
import { CloudSyncManager } from './services/cloudSync';
import { computeStats, detectTiltFlags, identifyLeaks, groupByPeriod } from './services/leakDetector';

let therapyRex: TherapyRexEngine;
let cloudSync: CloudSyncManager;
let dbReady = false;

export function registerIpcHandlers() {
  therapyRex = new TherapyRexEngine();
  cloudSync = new CloudSyncManager();

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
      INSERT OR IGNORE INTO hands (id, session_id, site, game_type, stakes, timestamp, board, hero_cards, pot_size, won_pot, net_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          h.board.join(','), h.heroCards.join(','), Math.round(h.potSize * 100),
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

  // ─── Leak Detection & Stats ──────────────────────────────

  ipcMain.handle('leak:getStats', (_e, { limit = 500 } = {}) => {
    if (!dbReady) return null;
    const hands = sqlite.prepare(
      'SELECT id, net_amount, won_pot, timestamp, stakes, game_type, pot_size FROM hands ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as any[];
    const handIds = hands.map((h: any) => h.id);
    const allActions = handIds.length > 0
      ? sqlite.prepare(`SELECT hand_id, player_name, action_type, amount, street FROM actions WHERE hand_id IN (${handIds.map(() => '?').join(',')})`)
          .all(...handIds) as any[]
      : [];
    return computeStats(hands, allActions);
  });

  ipcMain.handle('leak:getTiltFlags', (_e, { limit = 200 } = {}) => {
    if (!dbReady) return [];
    const hands = sqlite.prepare(
      'SELECT id, net_amount, won_pot, timestamp, stakes, game_type, pot_size, hero_cards FROM hands ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as any[];
    const handIds = hands.map((h: any) => h.id);
    const allActions = handIds.length > 0
      ? sqlite.prepare(`SELECT hand_id, player_name, action_type, amount, street FROM actions WHERE hand_id IN (${handIds.map(() => '?').join(',')})`)
          .all(...handIds) as any[]
      : [];
    return detectTiltFlags(hands, allActions);
  });

  ipcMain.handle('leak:getLeaks', (_e, { limit = 500 } = {}) => {
    if (!dbReady) return [];
    const hands = sqlite.prepare(
      'SELECT id, net_amount, won_pot, timestamp, stakes, game_type, pot_size FROM hands ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as any[];
    const handIds = hands.map((h: any) => h.id);
    const allActions = handIds.length > 0
      ? sqlite.prepare(`SELECT hand_id, player_name, action_type, amount, street FROM actions WHERE hand_id IN (${handIds.map(() => '?').join(',')})`)
          .all(...handIds) as any[]
      : [];
    const stats = computeStats(hands, allActions);
    return identifyLeaks(stats);
  });

  ipcMain.handle('leak:getSummaries', (_e, { period = 'daily', limit = 1000 } = {}) => {
    if (!dbReady) return [];
    const hands = sqlite.prepare(
      'SELECT id, net_amount, won_pot, timestamp, stakes, game_type, pot_size, site, hero_cards FROM hands ORDER BY timestamp ASC LIMIT ?'
    ).all(limit) as any[];
    const handIds = hands.map((h: any) => h.id);
    const allActions = handIds.length > 0
      ? sqlite.prepare(`SELECT hand_id, player_name, action_type, amount, street FROM actions WHERE hand_id IN (${handIds.map(() => '?').join(',')})`)
          .all(...handIds) as any[]
      : [];
    return groupByPeriod(hands, allActions, period as 'daily' | 'weekly' | 'monthly');
  });

  // ─── Hand Tags ──────────────────────────────────────────

  ipcMain.handle('tags:add', (_e, handId: string, tag: string) => {
    if (!dbReady) return false;
    try {
      sqlite.prepare('INSERT OR IGNORE INTO hand_tags (hand_id, tag) VALUES (?, ?)').run(handId, tag);
      return true;
    } catch (_err) { return false; }
  });

  ipcMain.handle('tags:remove', (_e, handId: string, tag: string) => {
    if (!dbReady) return false;
    sqlite.prepare('DELETE FROM hand_tags WHERE hand_id = ? AND tag = ?').run(handId, tag);
    return true;
  });

  ipcMain.handle('tags:getForHand', (_e, handId: string) => {
    if (!dbReady) return [];
    return (sqlite.prepare('SELECT tag FROM hand_tags WHERE hand_id = ? ORDER BY created_at DESC').all(handId) as any[]).map(r => r.tag);
  });

  ipcMain.handle('tags:getAll', () => {
    if (!dbReady) return [];
    return sqlite.prepare('SELECT DISTINCT tag FROM hand_tags ORDER BY tag').all().map((r: any) => r.tag);
  });

  ipcMain.handle('tags:getHandsByTag', (_e, tag: string) => {
    if (!dbReady) return [];
    return sqlite.prepare(
      'SELECT h.* FROM hands h JOIN hand_tags t ON h.id = t.hand_id WHERE t.tag = ? ORDER BY h.timestamp DESC'
    ).all(tag);
  });

  // ─── Therapy Rex (Session Review) ────────────────────────

  ipcMain.handle('rex:analyzeSession', async (_e, sessionId: string) => {
    if (!dbReady) return null;
    const hands = sqlite.prepare('SELECT * FROM hands WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
    if (hands.length === 0) {
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
}
