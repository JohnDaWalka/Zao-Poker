import { contextBridge, ipcRenderer } from 'electron';

// Generic IPC listener bridge
contextBridge.exposeInMainWorld('ipc', {
  on: (channel: string, callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
    ipcRenderer.on(channel, callback);
  },
  off: (channel: string, callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
    ipcRenderer.off(channel, callback);
  }
});

// Full Poker Suite API
contextBridge.exposeInMainWorld('pokerAPI', {
  // Live hand watcher
  onNewHand: (callback: (data: { site: string; raw: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { site: string; raw: string }) => callback(data);
    ipcRenderer.on('new-hand-history', listener);
    return () => ipcRenderer.off('new-hand-history', listener);
  },
  onNewParsedHand: (callback: (data: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('new-parsed-hand', listener);
    return () => ipcRenderer.off('new-parsed-hand', listener);
  },
  onAppLog: (callback: (data: { msg: string; type: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('app-log', listener);
    return () => ipcRenderer.off('app-log', listener);
  },

  // Database
  getHands: (opts?: any) => ipcRenderer.invoke('db:getHands', opts),
  getHandById: (id: string) => ipcRenderer.invoke('db:getHandById', id),
  getSessions: (opts?: any) => ipcRenderer.invoke('db:getSessions', opts),
  getSessionHands: (sessionId: string) => ipcRenderer.invoke('db:getSessionHands', sessionId),
  getStats: () => ipcRenderer.invoke('db:getStats'),
  importParsedHands: (hands: any[]) => ipcRenderer.invoke('db:importParsedHands', hands),

  // Therapy Rex Coach
  analyzeSession: (sessionId: string) => ipcRenderer.invoke('rex:analyzeSession', sessionId),
  analyzeRecentHands: (count?: number) => ipcRenderer.invoke('rex:analyzeRecentHands', count),

  // Cloud Sync
  getCloudTargets: () => ipcRenderer.invoke('cloud:getTargets'),
  addCloudTarget: (target: any) => ipcRenderer.invoke('cloud:addTarget', target),
  updateCloudTarget: (id: string, updates: any) => ipcRenderer.invoke('cloud:updateTarget', id, updates),
  removeCloudTarget: (id: string) => ipcRenderer.invoke('cloud:removeTarget', id),
  detectCloudFolders: () => ipcRenderer.invoke('cloud:detectFolders'),

  // Parser
  parseHandText: (text: string, site: string) => ipcRenderer.invoke('parser:parseText', text, site),
  importFile: () => ipcRenderer.invoke('parser:importFile'),

  // App
  getDriveHudPath: () => ipcRenderer.invoke('app:getDriveHudPath'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getHeroName: () => ipcRenderer.invoke('app:getHeroName'),
  setHeroName: (name: string) => ipcRenderer.invoke('app:setHeroName', name),

  // Hand History Paths (multi-client)
  getHHClients: () => ipcRenderer.invoke('app:getHHClients'),
  getActiveHHPaths: () => ipcRenderer.invoke('app:getActiveHHPaths'),
  addCustomHHPath: (p: string, site: string) => ipcRenderer.invoke('app:addCustomHHPath', p, site),
  removeCustomHHPath: (p: string) => ipcRenderer.invoke('app:removeCustomHHPath', p),
  browseFolder: () => ipcRenderer.invoke('app:browseFolder'),

  // Backup
  runBackup: () => ipcRenderer.invoke('app:runBackup'),
  getBackups: () => ipcRenderer.invoke('app:getBackups'),
  getBackupDir: () => ipcRenderer.invoke('app:getBackupDir'),

  // Leak Detection & Stats
  getLeakStats: (opts?: any) => ipcRenderer.invoke('db:getLeakStats', opts),
  getTiltFlags: (opts?: any) => ipcRenderer.invoke('db:getTiltFlags', opts),
  getLeaks: (opts?: any) => ipcRenderer.invoke('db:getLeaks', opts),

  // Summaries
  getSummaries: (opts?: any) => ipcRenderer.invoke('db:getSummaries', opts),

  // Gameplay Analysis
  getGameplayAnalysis: () => ipcRenderer.invoke('db:getGameplayAnalysis'),

  // Hand Tags
  addTag: (handId: string, tag: string) => ipcRenderer.invoke('db:addTag', handId, tag),
  removeTag: (handId: string, tag: string) => ipcRenderer.invoke('db:removeTag', handId, tag),
  getTagsForHand: (handId: string) => ipcRenderer.invoke('db:getTagsForHand', handId),
  getAllTags: () => ipcRenderer.invoke('db:getAllTags'),
  getHandsByTag: (tag: string) => ipcRenderer.invoke('db:getHandsByTag', tag),

  // DriveHUD 2 Sync
  dh2GetStatus: () => ipcRenderer.invoke('dh2:getStatus'),
  dh2SyncNow: () => ipcRenderer.invoke('dh2:syncNow'),
  dh2GetPlayers: () => ipcRenderer.invoke('dh2:getPlayers'),
  dh2GetTournaments: (limit?: number) => ipcRenderer.invoke('dh2:getTournaments', limit),
  dh2PushHandNote: (handNumber: string, note: string, siteId?: number) =>
    ipcRenderer.invoke('dh2:pushHandNote', handNumber, note, siteId),
  dh2PushPlayerNote: (playerName: string, note: string, siteId?: number) =>
    ipcRenderer.invoke('dh2:pushPlayerNote', playerName, note, siteId),
  dh2GetHandNotes: () => ipcRenderer.invoke('dh2:getHandNotes'),
  dh2GetPlayerNotes: () => ipcRenderer.invoke('dh2:getPlayerNotes'),
  dh2ResetSync: () => ipcRenderer.invoke('dh2:resetSync'),
  dh2SetPollInterval: (ms: number) => ipcRenderer.invoke('dh2:setPollInterval', ms),
  onDH2SyncUpdate: (callback: (data: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('dh2-sync-update', listener);
    return () => ipcRenderer.off('dh2-sync-update', listener);
  },
});

function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true);
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true);
        }
      });
    }
  });
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child);
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child);
    }
  },
};

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`;
  const style = document.createElement('style');
  const ospin = document.createElement('div');

  style.innerHTML = `
  .${className} > div {
    animation-fill-mode: both;
    width: 50px;
    height: 50px;
    background: #fff;
    animation: ${className} 3s 0s linear infinite;
  }
  .${className} {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  @keyframes ${className} {
    0% {
      transform: perspective(100px) rotateX(0deg) rotateY(0deg);
    }
    25% {
      transform: perspective(100px) rotateX(180deg) rotateY(0deg);
    }
    50% {
      transform: perspective(100px) rotateX(180deg) rotateY(180deg);
    }
    75% {.
      transform: perspective(100px) rotateX(0deg) rotateY(180deg);
    }
    100% {
      transform: perspective(100px) rotateX(0deg) rotateY(0deg);
    }
  }
  `;

  ospin.className = className;
  ospin.innerHTML = `<div></div>`;

  return {
    append: () => {
      safeDOM.append(document.head, style);
      safeDOM.append(document.body, ospin);
    },
    remove: () => {
      safeDOM.remove(document.head, style);
      safeDOM.remove(document.body, ospin);
    },
  };
}

// ----------------------------------------------------------------------

const { append: appendLoading, remove: removeLoading } = useLoading();
domReady().then(appendLoading);

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading();
};

setTimeout(removeLoading, 4999);
