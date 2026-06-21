
import { app, BrowserWindow, ipcMain, screen, dialog } from 'electron';
import path from 'node:path';
import fs from 'fs';
import { initDatabase } from './db/index';
import { checkActiveWindows } from './tracking';
import { overlayManager } from './overlayManager';
import { writeHandSummary } from './handWriter';
import { registerIpcHandlers, hhPathManager, getHeroName, dh2Sync } from './ipcHandlers';
import { parseHandHistory } from './services/handParser';
import { CloudSyncManager } from './services/cloudSync';
import { DriveHud2Sync } from './services/driveHud2Sync';

let dbUrl: string;
let db: any;
let startHandHistoryWatcher: any;
let cloudSync: CloudSyncManager | null = null;
let dh2SyncInstance: DriveHud2Sync | null = null;

// Paths
let driveHud2Path = "";
let historyWatcher: any = null;

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Poker Therapist Suite',
    icon: path.join(process.env.VITE_PUBLIC, 'vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0f172a',
    show: false,
  });

  win.once('ready-to-show', () => win?.show());

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST, 'index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    overlayManager.destroy();
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(async () => {
  // Setup logging
  try {
    const logPath = path.join(app.getPath('userData'), 'poker-therapist.log');
    const logFile = fs.createWriteStream(logPath, { flags: 'a' });
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => { logFile.write(`[INFO] ${new Date().toISOString()} ${args.join(' ')}\n`); origLog(...args); };
    console.error = (...args) => { logFile.write(`[ERROR] ${new Date().toISOString()} ${args.join(' ')}\n`); origErr(...args); };
    console.log('=== Poker Therapist Suite starting ===');
  } catch (_e) { /* continue without file logging */ }

  // Register all IPC handlers (DB, Rex, CloudSync, Parser)
  try {
    registerIpcHandlers();
    console.log('IPC handlers registered');
  } catch (err) {
    console.error('Failed to register IPC handlers:', err);
  }

  // Initialize cloud sync
  try {
    cloudSync = new CloudSyncManager();
    console.log('Cloud sync targets:', cloudSync.getTargets().map(t => t.name).join(', ') || 'none detected');
  } catch (err) {
    console.error('Cloud sync init failed:', err);
  }

  // Initialize DB
  try {
    const historyWatcherModule = await import('./historyWatcher');
    startHandHistoryWatcher = historyWatcherModule.startHandHistoryWatcher;
    const dbData = initDatabase();
    dbUrl = dbData.dbUrl;
    db = dbData.db;
    console.log('Database initialized at:', dbUrl);
  } catch (err) {
    console.error('CRITICAL STARTUP ERROR:', err);
    dialog.showErrorBox('Startup Error', `Failed to initialize.\n${err}`);
  }

  driveHud2Path = path.join(app.getPath('appData'), 'DriveHUD 2', 'ProcessedData');
  createWindow();

  // Initialize DriveHUD 2 Database Sync
  try {
    const { sqlite: localSqlite } = require('./db/index');
    dh2SyncInstance = new DriveHud2Sync({
      pollIntervalMs: 5000,
      heroName: getHeroName(),
      onNewHands: (parsedHands) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('new-parsed-hand', parsedHands);
          win.webContents.send('dh2-sync-update', { type: 'new-hands', count: parsedHands.length });
        }
      },
      onLog: (msg, type) => {
        console.log(`[DH2] ${msg}`);
        if (win && !win.isDestroyed()) win.webContents.send('app-log', { msg, type });
      },
    });
    dh2SyncInstance.setLocalDb(localSqlite);

    // Make it available to IPC handlers via module-level export
    const ipcModule = require('./ipcHandlers');
    ipcModule.dh2Sync = dh2SyncInstance;

    dh2SyncInstance.start();
    console.log('DriveHUD 2 sync started (polling every 5s)');
  } catch (err) {
    console.error('DriveHUD 2 sync init failed:', err);
  }

  // Poll active poker windows
  setInterval(() => {
    checkActiveWindows((data: any) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('active-window-data', data);
      }
      if (data?.bounds) {
        overlayManager.updateOverlay(data.windowTitle, data.bounds);
      }
    });
  }, 1000);

  const sendLog = (msg: string, type: 'info' | 'error') => {
    console.log(`[Watcher] ${msg}`);
    if (win && !win.isDestroyed()) win.webContents.send('app-log', { msg, type });
  };

  const onNewHand = (newContent: string, site: string) => {
    console.log(`[${site}] New hand data received (${newContent.length} chars)`);

    writeHandSummary(site, newContent);

    const parsedHands = parseHandHistory(newContent, site, getHeroName());

    if (parsedHands.length > 0) {
      const { sqlite } = require('./db/index');
      const insertHand = sqlite.prepare(`
        INSERT OR IGNORE INTO hands
          (id, session_id, site, game_type, stakes, timestamp, board, hero_cards, hero_name, pot_size, won_pot, net_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertAction = sqlite.prepare(`
        INSERT INTO actions (hand_id, player_name, action_type, amount, street)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const h of parsedHands) {
        try {
          const ts = new Date(h.timestamp).getTime();
          const res = insertHand.run(
            h.id, null, h.site, h.gameType, h.stakes, ts,
            h.board.join(','), h.heroCards.join(','), h.heroName || null,
            Math.round(h.potSize * 100), h.heroWon ? 1 : 0,
            Math.round(h.heroNetAmount * 100)
          );
          if (res.changes > 0) {
            for (const a of h.actions) {
              insertAction.run(h.id, a.playerName, a.type, Math.round((a.amount || 0) * 100), a.street);
            }
          }
        } catch (_e) { /* skip duplicates */ }
      }
    }

    if (cloudSync) {
      cloudSync.syncHandText(newContent, site, sendLog);
    }

    if (win && !win.isDestroyed()) {
      win.webContents.send('new-hand-history', { site, raw: newContent });
      if (parsedHands.length > 0) {
        win.webContents.send('new-parsed-hand', parsedHands);
      }
    }
  };

  // Get all active HH paths from all poker clients (CoinPoker, BetACR, DriveHUD2, PokerStars + custom)
  const activePaths = hhPathManager.getActivePaths();
  const pathsToWatch = activePaths.map(p => p.path).filter(p => fs.existsSync(p));

  // Always include DriveHUD2 path as fallback
  if (!pathsToWatch.includes(driveHud2Path) && fs.existsSync(driveHud2Path)) {
    pathsToWatch.push(driveHud2Path);
  }

  sendLog(`Watching ${pathsToWatch.length} HH path(s): ${pathsToWatch.join(', ') || 'none found yet'}`, 'info');

  if (pathsToWatch.length > 0) {
    historyWatcher = startHandHistoryWatcher(pathsToWatch, onNewHand, sendLog);
  } else {
    // Watch DriveHUD2 path regardless (will log error if not found)
    historyWatcher = startHandHistoryWatcher([driveHud2Path], onNewHand, sendLog);
  }
});
