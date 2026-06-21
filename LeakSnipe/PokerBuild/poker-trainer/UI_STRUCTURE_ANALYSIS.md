# UI Structure Analysis for Poker Therapist Suite

## Summary
The `src` directory **does not yet exist** but is expected by:
- `index.html` (references `/src/main.tsx`)
- `vite.config.ts` (configured for React)
- `package.json` (lists React, react-dom, lucide-react, recharts dependencies)

## Technology Stack Confirmed

### Frontend Framework
- **React 19.2.0** - Main UI framework
- **React DOM 19.2.0** - DOM rendering
- **React Router DOM 7.13.1** - Routing (for multi-page navigation)
- **TypeScript ~5.9.3** - Type safety
- **Vite 7.3.1** - Build tool

### UI Components & Libraries
- **Lucide React 0.577.0** - Icons
- **Recharts 3.7.0** - Data visualization/charts
- **Tailwind CSS** - Styling (tailwind.config.js exists)

### Electron Setup
- **Electron 40.6.1** - Desktop framework
- **Vite Plugin Electron 0.29.0** - Electron integration
- **React Vite Plugin 5.1.1** - React support

## Preload & IPC API Available to React App

The `electron/preload.ts` exposes a `window.pokerAPI` object with:

### Live Hand Events
```typescript
onNewHand(callback) - Raw hand history text received
onNewParsedHand(callback) - Structured parsed hand data
onAppLog(callback) - Application logs
```

### Database Methods
```typescript
getHands(opts?) - Fetch hands with filters
getHandById(id) - Single hand details
getSessions(opts?) - Get poker sessions
getSessionHands(sessionId) - Hands in a session
getStats() - Overall statistics
importParsedHands(hands[]) - Bulk import
```

### AI Analysis (Therapy Rex Coach)
```typescript
analyzeSession(sessionId) - AI analysis of entire session
analyzeRecentHands(count?) - AI analysis of recent hands
```

### Cloud Sync
```typescript
getCloudTargets() - List configured cloud targets
addCloudTarget(target) - Add cloud sync location
updateCloudTarget(id, updates) - Update target config
removeCloudTarget(id) - Remove sync target
detectCloudFolders() - Auto-detect cloud folders (Dropbox, OneDrive, etc.)
```

### Hand Parsing & Import
```typescript
parseHandText(text, site) - Parse raw hand history
importFile() - File dialog to select hands file
```

### App Info
```typescript
getDriveHudPath() - Path to DriveHUD 2 data
getVersion() - App version
```

## Existing Component Examples

### Poker-Therapist/desktop/renderer/
This appears to be an older/alternative renderer with:
- `app.js` - Main app logic
- `styles.css` - Base styles
- `index.html` - Likely deprecated version

This should be **superseded** by the React app in `/src`.

## Expected src Directory Structure

Based on the React + Electron + TypeScript setup, the `src` directory should contain:

```
src/
├── main.tsx                 # React entry point (renders to #root in index.html)
├── App.tsx                  # Root component with routing
├── App.css                  # Global styles
│
├── components/              # Reusable UI components
│   ├── common/             # Shared components
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Card.tsx
│   │   └── DataTable.tsx
│   │
│   └── poker/              # Domain-specific components
│       ├── HandViewer.tsx
│       ├── SessionStats.tsx
│       ├── ActionTimeline.tsx
│       └── PlayerStats.tsx
│
├── pages/                   # Full page components (for routing)
│   ├── Dashboard.tsx        # Home/overview
│   ├── Sessions.tsx         # Browsable session history
│   ├── HandHistory.tsx      # Detailed hand review
│   ├── Analytics.tsx        # Charts and statistics
│   ├── AICoach.tsx          # Therapy Rex analysis
│   ├── CloudSync.tsx        # Cloud integration settings
│   └── Settings.tsx         # App configuration
│
├── types/                   # TypeScript interfaces
│   ├── poker.ts            # Hand, Session, Action types
│   ├── api.ts              # IPC response types
│   └── ui.ts               # Component prop types
│
├── hooks/                   # Custom React hooks
│   ├── usePokerAPI.ts      # Wrap window.pokerAPI
│   ├── useHands.ts         # Hand fetching logic
│   ├── useSessions.ts      # Session state management
│   └── useStats.ts         # Statistics queries
│
├── store/                   # State management (if needed)
│   ├── handSlice.ts        # Redux slice for hands (if using Redux)
│   └── sessionSlice.ts     # Redux slice for sessions
│
├── utils/                   # Utility functions
│   ├── formatting.ts       # Format currency, dates, etc.
│   ├── calculations.ts     # Poker math (ROI, winrate, etc.)
│   └── chartData.ts        # Transform data for Recharts
│
└── styles/                  # Global and component styles
    ├── globals.css         # Tailwind/global styles
    ├── variables.css       # CSS variables
    └── theme.css           # Dark mode theme
```

## Key Features the UI Must Support

Based on `electron/preload.ts` and `electron/main.ts`:

1. **Live Hand Watcher Dashboard**
   - Display incoming hands in real-time
   - Show raw hand text and parsed data side-by-side
   - Latest hands counter
   - Currently watched sites indicator

2. **Session Browser**
   - List all poker sessions
   - Filter by date, site, game type
   - Session statistics (hands played, winrate, duration)
   - Click to view session details

3. **Hand Reviewer**
   - Full hand details (board, hole cards, actions)
   - Action timeline visualization
   - Pot size progression
   - Player position and stack info

4. **Analytics Dashboard**
   - Winrate trends over time (Recharts)
   - Game type breakdown (pie/bar charts)
   - Session length distribution
   - ROI by stakes

5. **AI Coach Interface**
   - Display Therapy Rex analysis
   - Session summary with key decisions
   - Hand-by-hand coaching notes
   - Actionable recommendations

6. **Cloud Sync Manager**
   - List configured sync targets
   - Add/remove cloud storage (Dropbox, OneDrive, Google Drive)
   - Sync status indicators
   - Manual sync triggers

7. **Hand Parser/Importer**
   - Text input for raw hand paste
   - File picker for bulk import
   - Parse preview
   - Import confirmation

8. **App Settings**
   - DriveHUD 2 folder configuration
   - Cloud storage settings
   - UI theme/preferences
   - About & version info

## Electron/React Communication Pattern

All React components access Electron features via:

```typescript
// In any React component:
import { useEffect, useState } from 'react';

export function MyComponent() {
  const [hands, setHands] = useState([]);
  
  useEffect(() => {
    // Call Electron IPC
    window.pokerAPI.getHands().then(setHands);
    
    // Listen for live updates
    const unsubscribe = window.pokerAPI.onNewParsedHand((hand) => {
      setHands(prev => [hand, ...prev]);
    });
    
    return unsubscribe;
  }, []);
  
  return <div>{/* render hands */}</div>;
}
```

## CSS & Styling

- **Tailwind Config exists** at `tailwind.config.js`
- **PostCSS Config exists** at `postcss.config.js`
- Electron background color set to `#0f172a` (dark slate)
- Should use Tailwind for responsive, dark-themed design
- Lucide React icons for consistent iconography

## Build & Development

```bash
# Dev server (HMR enabled for React)
npm run dev

# Build for production
npm run build   # Runs: tsc -b && vite build

# Package as executable
npm run package # Runs: npm run build && electron-builder

# Lint
npm run lint
```

## Current State

- ❌ `/src` directory does not exist
- ✅ `index.html` ready (references `/src/main.tsx`)
- ✅ `electron/main.ts` running and listening to poker sites
- ✅ `electron/preload.ts` exposing full API
- ✅ Dependencies installed (React, Recharts, Lucide, Tailwind)
- ✅ Build tooling configured (Vite, TypeScript, ESLint)

## Next Steps

1. Create `/src/main.tsx` - React entry point
2. Create `/src/App.tsx` - Root component with routing
3. Implement page components in `/src/pages/`
4. Create custom hooks for Electron API (`/src/hooks/usePokerAPI.ts`)
5. Define TypeScript types (`/src/types/`)
6. Build components incrementally with data from `window.pokerAPI`
