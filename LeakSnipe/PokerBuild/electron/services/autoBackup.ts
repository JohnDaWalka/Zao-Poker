// Auto-backup service — backs up the SQLite DB every 12 hours
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export class AutoBackupService {
  private backupDir: string;
  private interval: NodeJS.Timeout | null = null;
  private onLog: (msg: string, type: 'info' | 'error') => void;

  constructor(onLog: (msg: string, type: 'info' | 'error') => void = () => {}) {
    this.onLog = onLog;
    this.backupDir = path.join(app.getPath('documents'), 'PokerTherapist', 'Backups');
  }

  getBackupDir(): string {
    return this.backupDir;
  }

  start(intervalHours = 12) {
    // Run once on startup after a 30s delay, then every 12h
    setTimeout(() => this.runBackup(), 30_000);
    this.interval = setInterval(() => this.runBackup(), intervalHours * 60 * 60 * 1000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  runBackup(): { success: boolean; files: string[] } {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }
      const srcDb = path.join(app.getPath('userData'), 'poker-tracker.sqlite');
      if (!fs.existsSync(srcDb)) {
        return { success: false, files: [] };
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const dest = path.join(this.backupDir, `poker-tracker-${stamp}.sqlite`);
      fs.copyFileSync(srcDb, dest);
      this.onLog(`[Backup] Saved: ${path.basename(dest)}`, 'info');

      // Keep only last 10 backups
      this.pruneOldBackups(10);
      return { success: true, files: [dest] };
    } catch (e) {
      this.onLog(`[Backup] Failed: ${e}`, 'error');
      return { success: false, files: [] };
    }
  }

  getBackups(): { name: string; date: string; sizeMB: number }[] {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir)
      .filter(f => f.endsWith('.sqlite'))
      .map(f => {
        const stat = fs.statSync(path.join(this.backupDir, f));
        return { name: f, date: stat.mtime.toISOString(), sizeMB: Math.round(stat.size / 1024 / 102.4) / 10 };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  private pruneOldBackups(keep: number) {
    const backups = this.getBackups();
    for (const b of backups.slice(keep)) {
      try { fs.unlinkSync(path.join(this.backupDir, b.name)); } catch (_) {}
    }
  }
}
