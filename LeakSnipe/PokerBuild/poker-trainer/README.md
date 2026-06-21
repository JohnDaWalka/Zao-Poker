# Poker Therapist - Comprehensive Tracker & Replayer

**Tech Stack:**
- **Frontend:** React + Vite + Typescript
- **Backend:** Electron + better-sqlite3 (SQLite) + drizzle-orm
- **Tracking:** get-windows (Window Monitoring) + chokidar (Log File Parsing)

## Prerequisites
1. **PNPM** installed (\
pm i -g pnpm\)
2. **Node.js 18+**

## How to Run (Development)
Simply double-click \Launch.bat\ or run:
\\\ash
pnpm install
pnpm run dev
\\\

## How to Build Executable (.exe)
We have prepared a PowerShell build script that handles TypeScript compilation, Vite bundling, and Electron packaging.

1. Open PowerShell in this folder.
2. Run:
   \\\powershell
   ./build_exe.ps1
   \\\
3. The output executable will be in the \
elease/\ folder.
   - If build fails, ensure \dist-electron/main.js\ was created.

## Features Implemented
- **Hand History Parsing:** Automatically detects ACR and CoinPoker hand histories from disk.
- **HUD Overlay:** Displays live stats overlay on active tables.
- **Dashboard:** View imported hands and session stats.
- **Hand Replayer:** Visual replayer for analyzing hands.
- **Database:** Local SQLite storage for all hands/sessions/players.

## Notes
- This app uses \get-windows\ and \etter-sqlite3\, so packaging requires native module rebuilding. If \lectron-builder\ hangs or fails, ensure you have Python/C++ build tools.
