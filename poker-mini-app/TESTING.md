# ZAO Poker — Testing & Pre-Deployment Guide

This document covers how to test the ZAO Poker mini app locally and validate everything before deploying to production.

---

## Table of Contents

1. [Quick Start (Local Testing)](#quick-start-local-testing)
2. [In-App Tester](#in-app-tester)
3. [Farcaster Preview Testing](#farcaster-preview-testing)
4. [Pre-Deployment Checklist](#pre-deployment-checklist)
5. [Troubleshooting](#troubleshooting)
6. [Reference Links](#reference-links)

---

## Quick Start (Local Testing)

### 1. Start the Dev Server

```bash
cd poker-mini-app
npm run dev
```

This starts the Next.js dev server on `http://localhost:3000` (or the next available port).

### 2. Open the In-App Tester

Navigate to `http://localhost:3000/tester` in your browser.

This page runs automated checks and shows:
- Mini App SDK status
- Farcaster context (if running inside Warpcast)
- API connectivity
- Manifest validity
- SDK action buttons for manual testing

### 3. (Optional) Expose to Internet for Farcaster Preview

```bash
npm run tunnel
```

This script:
- Detects if you have `cloudflared` (recommended, no account needed) or `ngrok`
- Creates a public HTTPS tunnel to your localhost
- Prints the public URL and direct links to Farcaster preview tools

**Install Cloudflare (recommended):**
- **Windows**: Download from [Cloudflare Downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
- **Mac**: `brew install cloudflared`
- **Linux**: `sudo apt install cloudflared`

---

## In-App Tester

The in-app tester lives at `/tester` and provides:

### System Checks
- ✅ Mini App SDK loaded
- ✅ Farcaster context available
- ✅ Runtime host detected (Farcaster, iOS Safari, Android Chrome, Desktop)
- ✅ API table route responding
- ✅ Farcaster manifest valid
- ✅ Environment variables set

### Context Inspector
Shows the raw Farcaster context JSON (user FID, username, client info, safe area insets, etc.).

### SDK Actions Test
Buttons to manually test:
- `sdk.actions.ready()`
- `sdk.actions.openUrl()`
- `sdk.actions.viewProfile()`
- Runtime info dump

### External Testing Links
- **Farcaster Mini App Previewer**: `https://farcaster.xyz/~/developers/mini-apps/preview`
- **Warpcast Developer Tools**: `https://farcaster.xyz/~/developers/`
- Direct manifest link
- API endpoint link

---

## Farcaster Preview Testing

### Method 1: Farcaster Mini App Previewer (Web)

1. Run `npm run tunnel` to get a public URL
2. Go to `https://farcaster.xyz/~/developers/mini-apps/preview`
3. Paste your tunnel URL (e.g., `https://xxxx.trycloudflare.com`)
4. Click **Preview**

### Method 2: Warpcast Developer Tools (Full Debugger)

1. Run `npm run tunnel` to get a public URL
2. Go to `https://farcaster.xyz/~/developers/`
3. Enter your tunnel URL
4. Test splash screens, launch flow, and metadata

### Method 3: Test Inside Warpcast Mobile App

1. Run `npm run tunnel` to get a public URL
2. Cast the URL in Warpcast (or DM it to yourself)
3. Tap the link on your phone to open the mini app
4. Test on real device with actual Farcaster context

---

## Pre-Deployment Checklist

Before deploying to Vercel, verify:

### Code Quality
- [ ] `npm run test` passes (68 unit tests)
- [ ] `npm run lint` passes
- [ ] `tsc --noEmit --skipLibCheck` has 0 errors

### Local Integration
- [ ] App loads at `http://localhost:3000`
- [ ] In-app tester at `/tester` shows all green
- [ ] Farcaster manifest at `/.well-known/farcaster.json` loads correctly
- [ ] API table at `/api/table` responds with 200
- [ ] Poker gameplay works (take seat, play hand, betting, showdown)

### Farcaster Preview (via tunnel)
- [ ] Mini App Previewer loads the app without errors
- [ ] Splash screen shows correctly
- [ ] SDK context is available (shows user FID)
- [ ] `sdk.actions.ready()` succeeds
- [ ] In-app tester passes all checks via tunnel URL

### Production Environment
- [ ] `VERCEL_TOKEN` is set in GitHub repository secrets
- [ ] `NEXT_PUBLIC_APP_URL` points to production domain
- [ ] `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are configured (if using Turso)

### Deployment
- [ ] Push to `main` branch triggers GitHub Actions workflow
- [ ] `check-deploy.mjs` passes against production URLs
- [ ] App loads on production URL without errors

---

## Troubleshooting

### SDK Not Loading

**Symptom**: In-app tester shows "SDK not loaded"

**Cause**: You're testing in a regular browser, not inside Farcaster/Warpcast.

**Fix**: Use `npm run tunnel` and test via the Farcaster Mini App Previewer, or use the Warpcast mobile app.

### Tunnel Not Working

**Symptom**: `npm run tunnel` says no tunnel tool found

**Fix**: Install Cloudflare:
```bash
# Mac
brew install cloudflared

# Linux
sudo apt install cloudflared

# Windows: Download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

### API Returns 500

**Symptom**: `/api/table` returns 500

**Fix**: Check that your local SQLite database exists or that Turso credentials are configured in `.env.local`.

### Manifest Errors

**Symptom**: Farcaster manifest shows errors

**Fix**: Verify `APP_ACCOUNT_ASSOCIATION` in `src/lib/constants.ts` is valid and matches your production domain.

### Farcaster Preview Shows Blank Page

**Symptom**: Mini App Previewer shows blank/white page

**Fix**: 
1. Check browser console for CORS errors
2. Ensure your tunnel URL is HTTPS (Cloudflare and ngrok both provide this)
3. Verify the app loads directly in browser at the tunnel URL

---

## Reference Links

> **Note (Jan 2026):** Neynar has acquired Farcaster, taking over protocol operations, the Warpcast app, and Clanker. The protocol remains open-source and permissionless. See [Dan Romero's announcement](https://farcaster.xyz/dwr/0x72aab3a5).

| Resource | URL |
|----------|-----|
| Farcaster Mini App Previewer | `https://farcaster.xyz/~/developers/mini-apps/preview` |
| Warpcast Developer Tools | `https://farcaster.xyz/~/developers/` |
| Neynar Docs | `https://docs.neynar.com/docs/how-to-build-farcaster-frames-with-neynar` |
| Farcaster Mini App Spec | `https://docs.farcaster.xyz/developers/frames/` |
| Neynar-Farcaster Announcement | `https://www.theblock.co/post/386549/haun-backed-neynar-acquires-farcaster-after-founders-pivot-to-wallet-app` |
| Cloudflare Tunnel Docs | `https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/` |
| ngrok Download | `https://ngrok.com/download` |
| frames.js Debugger | `npm install -g @frames.js/debugger@latest` |

---

## Script Reference

| Script | Command | Purpose |
|--------|---------|---------|
| Dev server | `npm run dev` | Start local Next.js dev server |
| Unit tests | `npm run test` | Run 68 vitest tests |
| Type check | `tsc --noEmit --skipLibCheck` | TypeScript validation |
| Lint | `npm run lint` | ESLint checks |
| Tunnel | `npm run tunnel` | Expose localhost to internet |
| Deploy check | `node scripts/check-deploy.mjs <url>` | Validate deployed app |
