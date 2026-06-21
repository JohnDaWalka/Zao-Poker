import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';

export interface ParseResult {
  raw: string;
  // TODO: Add strongly typed hand schema
}

export function startHandHistoryWatcher(
  dirPaths: string[],
  onNewHand: (hand: string, site: string) => void,
  onLog: (msg: string, type: 'info' | 'error') => void = () => {}
) {
  onLog(`Starting hand history watcher on directories: ${JSON.stringify(dirPaths)}`, 'info');
  // console.log already handled by main process override if calling this from there

  // Verify paths exist
  const existingPaths = dirPaths.filter(p => {
    if (fs.existsSync(p)) {
      onLog(`[Watcher] Path exists: ${p}`, 'info');
      return true;
    } else {
      onLog(`[Watcher] Path NOT found: ${p}`, 'error');
      return false;
    }
  });

  if (existingPaths.length === 0) {
    onLog('[Watcher] No valid hand history paths found to watch!', 'error');
    return null;
  }

  const watcher = chokidar.watch(existingPaths, {
    persistent: true,
    ignoreInitial: false, 
    depth: 3,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });

  const fileStates = new Map<string, number>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingChunks: { content: string; site: string }[] = [];
  const DEBOUNCE_MS = 3000;

  function flushPending() {
    debounceTimer = null;
    const chunks = pendingChunks.splice(0);
    for (const { content, site } of chunks) {
      onNewHand(content, site);
    }
  }

  function queueHand(content: string, site: string) {
    pendingChunks.push({ content, site });
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPending, DEBOUNCE_MS);
  }

  watcher.on('ready', () => {
    onLog('[Watcher] Initial scan complete. Ready for changes.', 'info');
  });
  
  watcher.on('error', (error) => {
    onLog(`[Watcher] Chokidar Error: ${error}`, 'error');
  });

  watcher.on('add', (filePath) => {
    onLog(`[Watcher] File added: ${filePath}`, 'info');
    try {
      const stats = fs.statSync(filePath);
      fileStates.set(filePath, stats.size);
      
      // Sync to OneDrive immediately on add
      syncToOneDrive(filePath, onLog);

      // Read the existing content to sync history backwards
      if (stats.size > 0) {
        let content = fs.readFileSync(filePath, { encoding: 'utf8' });
        let site = 'Unknown';
        if (filePath.includes('ACR')) site = 'BetACR';
        else if (filePath.includes('CoinPoker')) site = 'CoinPoker';
        else if (filePath.includes('DriveHUD')) site = 'DriveHUD2';
        
        queueHand(content, site);
      }
    } catch (e) {
      console.error('File stat/read error on add', e);
      onLog(`[Watcher] Error on add: ${e}`, 'error');
    }
  });

  watcher.on('change', (filePath) => {
    try {
      const stats = fs.statSync(filePath);
      const previousSize = fileStates.get(filePath) || 0;
      const currentSize = stats.size;

      if (currentSize > previousSize) {
        const stream = fs.createReadStream(filePath, {
          encoding: 'utf8',
          start: previousSize,
          end: currentSize - 1,
        });

        let newContent = '';
        stream.on('data', (chunk) => {
          newContent += chunk.toString();
        });

        stream.on('end', () => {
          fileStates.set(filePath, currentSize);
          syncToOneDrive(filePath, onLog);

          let site = 'Unknown';
          if (filePath.includes('ACR')) site = 'BetACR';
          else if (filePath.includes('CoinPoker')) site = 'CoinPoker';
          else if (filePath.includes('DriveHUD')) site = 'DriveHUD2';

          queueHand(newContent, site);
        });
      }
    } catch (e) {
      console.error('File change error', e);
    }
  });

  return watcher;
}

function syncToOneDrive(filePath: string, onLog: (msg: string, type: 'info' | 'error') => void) {
  try {
    const fileName = path.basename(filePath);
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    const oneDrivePath = path.join(userProfile, 'OneDrive', 'PokerHandHistories');

    if (!fs.existsSync(oneDrivePath)) {
      fs.mkdirSync(oneDrivePath, { recursive: true });
    }

    const destPath = path.join(oneDrivePath, fileName);
    fs.copyFileSync(filePath, destPath);
    onLog(`[Sync] Copied ${fileName} to OneDrive`, 'info');
  } catch (err) {
    onLog(`[Sync] Failed to copy to OneDrive: ${err}`, 'error');
  }
}
