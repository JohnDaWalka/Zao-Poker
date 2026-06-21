// Auto-Backup Service — Windows-native
// Backs up SQLite DB + hand history files every 12 hours
// Targets: local backup dir, OneDrive, Google Drive

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_BACKUPS = 14; // keep 7 days of backups

export class AutoBackupService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private backupDir: string;
  private onLog: (msg: string, type: 'info' | 'error') => void;

  constructor(onLog?: (msg: string, type: 'info' | 'error') => void) {
    this.onLog = onLog || (() => {});
    this.backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  start() {
    this.onLog('[Backup] Auto-backup enabled (every 12 hours)', 'info');
    // Run first backup after 1 minute
    setTimeout(() => this.runBackup(), 60_000);
    this.timer = setInterval(() => this.runBackup(), BACKUP_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runBackup(): Promise<{ success: boolean; files: string[] }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `backup-${timestamp}`;
    const backupPath = path.join(this.backupDir, backupName);

    try {
      fs.mkdirSync(backupPath, { recursive: true });
      const backedUp: string[] = [];

      // 1. Backup SQLite database
      const dbPath = path.join(app.getPath('userData'), 'poker-tracker.sqlite');
      if (fs.existsSync(dbPath)) {
        const dest = path.join(backupPath, 'poker-tracker.sqlite');
        fs.copyFileSync(dbPath, dest);
        backedUp.push('poker-tracker.sqlite');
      }

      // 2. Backup settings files
      const settingsFiles = ['cloud-sync-settings.json', 'hh-paths.json'];
      for (const sf of settingsFiles) {
        const sfPath = path.join(app.getPath('userData'), sf);
        if (fs.existsSync(sfPath)) {
          fs.copyFileSync(sfPath, path.join(backupPath, sf));
          backedUp.push(sf);
        }
      }

      // 3. Backup app log
      const logPath = path.join(app.getPath('userData'), 'poker-therapist.log');
      if (fs.existsSync(logPath)) {
        fs.copyFileSync(logPath, path.join(backupPath, 'poker-therapist.log'));
        backedUp.push('poker-therapist.log');
      }

      // 4. Copy backup to OneDrive if available
      const userProfile = process.env.USERPROFILE || '';
      const cloudTargets = [
        path.join(userProfile, 'OneDrive', 'PokerHandHistories', 'backups'),
        path.join(userProfile, 'OneDrive - CSCU', 'PokerHandHistories', 'backups'),
      ];
      // Google Drive
      const gDrivePaths = [
        path.join(userProfile, 'My Drive (maurofanellijr@gmail.com)', 'PokerHandHistories', 'backups'),
        path.join(userProfile, 'Google Drive', 'PokerHandHistories', 'backups'),
      ];
      cloudTargets.push(...gDrivePaths);

      for (const target of cloudTargets) {
        try {
          const parentDir = path.dirname(target);
          if (fs.existsSync(parentDir)) {
            if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
            const cloudBackupDir = path.join(target, backupName);
            fs.mkdirSync(cloudBackupDir, { recursive: true });
            // Copy DB backup to cloud
            const dbBackup = path.join(backupPath, 'poker-tracker.sqlite');
            if (fs.existsSync(dbBackup)) {
              fs.copyFileSync(dbBackup, path.join(cloudBackupDir, 'poker-tracker.sqlite'));
              this.onLog(`[Backup] Synced to ${path.basename(path.dirname(target))}`, 'info');
            }
          }
        } catch (_e) { /* cloud target unavailable */ }
      }

      // 5. Prune old backups (keep MAX_BACKUPS)
      this.pruneOldBackups();

      this.onLog(`[Backup] Completed: ${backedUp.length} files → ${backupName}`, 'info');
      return { success: true, files: backedUp };
    } catch (err) {
      this.onLog(`[Backup] Failed: ${err}`, 'error');
      return { success: false, files: [] };
    }
  }

  private pruneOldBackups() {
    try {
      const dirs = fs.readdirSync(this.backupDir)
        .filter(d => d.startsWith('backup-'))
        .sort()
        .reverse();

      for (let i = MAX_BACKUPS; i < dirs.length; i++) {
        const old = path.join(this.backupDir, dirs[i]);
        fs.rmSync(old, { recursive: true, force: true });
        this.onLog(`[Backup] Pruned old backup: ${dirs[i]}`, 'info');
      }
    } catch (_e) { /* ignore pruning errors */ }
  }

  getBackups(): { name: string; date: string; sizeMB: number }[] {
    try {
      return fs.readdirSync(this.backupDir)
        .filter(d => d.startsWith('backup-'))
        .sort()
        .reverse()
        .map(d => {
          const bp = path.join(this.backupDir, d);
          let totalSize = 0;
          try {
            for (const f of fs.readdirSync(bp)) {
              totalSize += fs.statSync(path.join(bp, f)).size;
            }
          } catch (_e) { /* empty */ }
          return {
            name: d,
            date: d.replace('backup-', '').replace(/T/, ' ').replace(/-/g, (m, offset) => offset > 9 ? ':' : '-'),
            sizeMB: Math.round(totalSize / 1024 / 1024 * 10) / 10,
          };
        });
    } catch (_e) {
      return [];
    }
  }

  getBackupDir(): string {
    return this.backupDir;
  }
}
