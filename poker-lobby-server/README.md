# Poker Lobby Server (for Render.com)

Minimal standalone Express + WebSocket server for authoritative real-time poker lobby state.

## Deploy to Render (one-click with render.yaml)

Push this folder (or whole repo) to GitHub, then in Render dashboard:
- New > Web Service
- Connect repo, set root to `poker-lobby-server` if monorepo
- It will auto-detect render.yaml
- Or use the Dockerfile for container deploy

Environment variables (same as mini-app):
- TURSO_DATABASE_URL
- TURSO_AUTH_TOKEN

Health check is at /health

## Local
cp .env.example .env
npm install
npm run dev


## Endpoints

- `GET /health` - Health check
- `GET /lobby` - Current lobby state (used by checks)
- `WS /ws` - Real-time updates
  - Send `{ "type": "get_state" }`
  - Receives `{ "type": "state", "payload": { tables: [...] } }`
- `POST /api/table` - Action endpoint (stub for now - integrate full logic)

## Connecting from the mini-app (Vercel)

Set in Vercel env:
```
NEXT_PUBLIC_RENDER_API_URL=https://your-lobby.onrender.com
NEXT_PUBLIC_RENDER_WS_URL=wss://your-lobby.onrender.com
```

The frontend will use the Render service for persistent table state (hands, board cards, actions) while staying on Vercel for the Farcaster UI.

## Next steps / full integration

- Use the shared `@zao-poker/core` for types and pure game functions.
- Port more of the logic from `poker-mini-app/src/app/api/table/route.ts` (dealNewHand, advanceGame, action handlers) into this server or the core package.
- Share the exact DB schema/migrations.

This gives persistent state across Farcaster sessions and hands.
