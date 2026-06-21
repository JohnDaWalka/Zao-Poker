// Native Windows file watcher — uses fs.watch (ReadDirectoryChangesW) + fast poll tailing
// No chokidar dependency — pure Node.js on Windows 11

import fs from 'fs';
import path from 'path';

const POLL_INTERVAL_MS = 500;   // tail poll every 500ms
const SCAN_INTERVAL_MS = 5000;  // new-file scan every 5s

export function startHandHistoryWatcher(
  dirPaths: string[],
  onNewHand: (hand: string, site: string) => void,
  onLog: (msg: string, type: 'info' | 'error') => void = () => {}
) {
  onLog(`[Watcher] Starting native Windows watcher on ${dirPaths.length} dirs`, 'info');

  const existingPaths = dirPaths.filter(p => {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        onLog(`[Watcher] Watching: ${p}`, 'info');
        return true;
      }
    } catch (_e) { /* skip */ }
    onLog(`[Watcher] Path NOT found: ${p}`, 'error');
    return false;
  });

  if (existingPaths.length === 0) {
    onLog('[Watcher] No valid hand history paths to watch!', 'error');
    return null;
  }

  // Track file sizes for incremental reads (tail)
  const fileStates = new Map<string, number>();
  const watchers: fs.FSWatcher[] = [];

  function detectSite(filePath: string): string {
    const fp = filePath.toLowerCase();
    if (fp.includes('coinpoker')) return 'CoinPoker';
    if (fp.includes('acr') || fp.includes('wpn') || fp.includes('americas cardroom') || fp.includes('betonline')) return 'BetACR';
    if (fp.includes('drivehud')) return 'DriveHUD2';
    if (fp.includes('pokerstars')) return 'PokerStars';
    return 'Unknown';
  }

  function readNewContent(filePath: string, site: string) {
    try {
      const stat = fs.statSync(filePath);
      const prev = fileStates.get(filePath) || 0;
      if (stat.size <= prev) return;

      // Read only new bytes (tail)
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(stat.size - prev);
      fs.readSync(fd, buf, 0, buf.length, prev);
      fs.closeSync(fd);

      fileStates.set(filePath, stat.size);
      const content = buf.toString('utf8');
      if (content.trim().length > 10) {
        onNewHand(content, site);
      }
    } catch (e) {
      onLog(`[Watcher] Read error ${filePath}: ${e}`, 'error');
    }
  }

  function processFile(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.txt', '.xml', '.log', ''].includes(ext)) return;
    const site = detectSite(filePath);
    readNewContent(filePath, site);
    syncToOneDrive(filePath, onLog);
  }

  // Recursively discover all HH files in a directory (up to 3 levels deep)
  function scanDir(dirPath: string, depth = 0): string[] {
    if (depth > 3) return [];
    const files: string[] = [];
    try {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          files.push(...scanDir(full, depth + 1));
        } else if (entry.isFile()) {
          files.push(full);
        }
      }
    } catch (_e) { /* inaccessible dir */ }
    return files;
  }

  // Initial scan — ingest all existing files
  for (const dir of existingPaths) {
    const files = scanDir(dir);
    onLog(`[Watcher] Found ${files.length} files in ${dir}`, 'info');
    for (const f of files) {
      fileStates.set(f, 0); // start at 0 to read full content
      processFile(f);
    }
  }

  // fs.watch on each directory (recursive: true on Windows uses ReadDirectoryChangesW)
  for (const dir of existingPaths) {
    try {
      const w = fs.watch(dir, { recursive: true, persistent: true }, (eventType, filename) => {
        if (!filename) return;
        const filePath = path.join(dir, filename);
        // Small delay to let writes finish
        setTimeout(() => {
          try {
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              processFile(filePath);
            }
          } catch (_e) { /* file gone */ }
        }, 300);
      });
      watchers.push(w);
    } catch (e) {
      onLog(`[Watcher] fs.watch failed for ${dir}: ${e}`, 'error');
    }
  }

  // Fast poll timer — tail all tracked files for new bytes
  const pollTimer = setInterval(() => {
    for (const [filePath] of fileStates) {
      try {
        const stat = fs.statSync(filePath);
        const prev = fileStates.get(filePath) || 0;
        if (stat.size > prev) {
          const site = detectSite(filePath);
          readNewContent(filePath, site);
        }
      } catch (_e) { /* file may have been deleted */ }
    }
  }, POLL_INTERVAL_MS);

  // Slower scan timer — discover newly created files
  const scanTimer = setInterval(() => {
    for (const dir of existingPaths) {
      for (const f of scanDir(dir)) {
        if (!fileStates.has(f)) {
          fileStates.set(f, 0);
          processFile(f);
          onLog(`[Watcher] New file discovered: ${path.basename(f)}`, 'info');
        }
      }
    }
  }, SCAN_INTERVAL_MS);

  onLog('[Watcher] Native Windows watcher active. Tailing every 500ms.', 'info');

  return {
    close() {
      clearInterval(pollTimer);
      clearInterval(scanTimer);
      for (const w of watchers) w.close();
    }
  };
}

function syncToOneDrive(filePath: string, onLog: (msg: string, type: 'info' | 'error') => void) {
  try {
    const userProfile = process.env.USERPROFILE || '';
    if (!userProfile) return;

    const oneDrivePath = path.join(userProfile, 'OneDrive', 'PokerHandHistories');
    if (!fs.existsSync(oneDrivePath)) {
      fs.mkdirSync(oneDrivePath, { recursive: true });
    }

    const fileName = path.basename(filePath);
    const destPath = path.join(oneDrivePath, fileName);
    fs.copyFileSync(filePath, destPath);
    onLog(`[Sync] Copied ${fileName} to OneDrive`, 'info');
  } catch (err) {
    onLog(`[Sync] OneDrive copy failed: ${err}`, 'error');
  }
}
