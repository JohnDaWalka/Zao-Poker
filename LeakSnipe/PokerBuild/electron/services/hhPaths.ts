// Hand History Path Manager
// Discovers and persists poker client HH directories for CoinPoker, BetACR, PokerStars, DriveHUD2

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface HHClient {
  name: string;
  site: string;
  paths: { path: string; exists: boolean }[];
}

export interface ActiveHHPath {
  path: string;
  site: string;
}

interface PersistedPaths {
  custom: ActiveHHPath[];
}

export class HHPathManager {
  private settingsPath: string;
  private customPaths: ActiveHHPath[] = [];

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'hh-paths.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data: PersistedPaths = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
        this.customPaths = data.custom || [];
      }
    } catch (_) {
      this.customPaths = [];
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify({ custom: this.customPaths }, null, 2), 'utf8');
    } catch (e) {
      console.error('[HHPaths] Failed to save:', e);
    }
  }

  // Returns all known clients and their candidate paths
  getKnownClients(): HHClient[] {
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    const appData = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(userProfile, 'AppData', 'Local');
    const roamingAppData = process.env.APPDATA || path.join(userProfile, 'AppData', 'Roaming');
    const docs = path.join(userProfile, 'Documents');

    const clients: HHClient[] = [
      {
        name: 'CoinPoker',
        site: 'CoinPoker',
        paths: [
          path.join(appData, 'CoinPoker', 'HandHistory'),
          path.join(appData, 'CoinPoker', 'hand_history'),
          path.join(docs, 'CoinPoker', 'HandHistory'),
          path.join(docs, 'CoinPoker'),
          path.join(roamingAppData, 'CoinPoker', 'HandHistory'),
        ].map(p => ({ path: p, exists: fs.existsSync(p) })),
      },
      {
        name: 'BetACR / Americas Cardroom',
        site: 'BetACR',
        paths: [
          path.join(docs, 'ACR Poker', 'HandHistory'),
          path.join(docs, 'Americas Cardroom', 'HandHistory'),
          path.join(roamingAppData, 'ACR Poker', 'HandHistory'),
          path.join(roamingAppData, 'WPN', 'HandHistory'),
          path.join(roamingAppData, 'Winning Poker Network', 'HandHistory'),
        ].map(p => ({ path: p, exists: fs.existsSync(p) })),
      },
      {
        name: 'DriveHUD 2',
        site: 'DriveHUD2',
        paths: [
          path.join(roamingAppData, 'DriveHUD 2', 'ProcessedData'),
          path.join(roamingAppData, 'DriveHUD2', 'ProcessedData'),
        ].map(p => ({ path: p, exists: fs.existsSync(p) })),
      },
      {
        name: 'PokerStars',
        site: 'PokerStars',
        paths: [
          path.join(docs, 'PokerStars', 'HandHistory'),
          path.join(roamingAppData, 'PokerStars', 'HandHistory'),
        ].map(p => ({ path: p, exists: fs.existsSync(p) })),
      },
    ];

    return clients;
  }

  // Returns paths that exist and should be watched (auto-detected + custom)
  getActivePaths(): ActiveHHPath[] {
    const autoPaths: ActiveHHPath[] = [];

    for (const client of this.getKnownClients()) {
      for (const p of client.paths) {
        if (p.exists) {
          autoPaths.push({ path: p.path, site: client.site });
          break; // only first existing path per client
        }
      }
    }

    // Merge with custom paths (deduplicate)
    const seen = new Set(autoPaths.map(p => p.path));
    for (const cp of this.customPaths) {
      if (!seen.has(cp.path)) {
        autoPaths.push(cp);
        seen.add(cp.path);
      }
    }

    return autoPaths;
  }

  addCustomPath(p: string, site: string): ActiveHHPath[] {
    const existing = this.customPaths.find(cp => cp.path === p);
    if (!existing) {
      this.customPaths.push({ path: p, site });
      this.save();
    }
    return this.getActivePaths();
  }

  removeCustomPath(p: string): ActiveHHPath[] {
    this.customPaths = this.customPaths.filter(cp => cp.path !== p);
    this.save();
    return this.getActivePaths();
  }
}
