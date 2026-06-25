# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## Repository overview

This is the **ZAO Poker** monorepo: a Web3 Farcaster Mini-App poker game plus a
collection of separate, loosely-related poker tooling projects. There is no
shared build system, package manager, or root-level dependency graph — each
top-level directory is an **independent project** with its own language,
package manager, and deployment target. Always `cd` into the relevant
subproject before running its tooling.

```
.
├── poker-mini-app/   # PRIMARY, actively developed: Next.js/React Farcaster mini-app (the poker table)
├── AI-Poker-Coach/   # Python FastAPI backend: AI hand analysis, equity sim, CFR/GTO, PQC security layer
├── LeakSnipe/        # Desktop app (Tauri + Python sidecar): OCR HUD / hand-history tracker for ACR Poker
├── Poker-COACH/      # Vue.js poker hand analysis tool + a separate, unrelated "Advent of Code" automation
└── poker-snap/       # Farcaster "Snap" (Frame-like) agent built on Hono, deployed to host.neynar.app
```

Read `README.md` at the root for the human-facing setup instructions
(local dev + Render/Vercel deployment). This file is about how to *work on*
the code, not how to run it as an end user.

## Where active development happens

`poker-mini-app/` is the project with the most recent commit activity (the
multiplayer poker table, betting HUD, AI opponents, Farcaster auth). When a
task description doesn't specify a subproject, check recent `git log --stat`
first — it is very likely about `poker-mini-app`.

`AI-Poker-Coach/` is the secondary active project (the analysis backend
consumed by the mini-app via `BACKEND_URL`/`NEXT_PUBLIC_BACKEND_URL`).

`LeakSnipe/`, `Poker-COACH/`, and `poker-snap/` are largely independent and
maintained separately; treat them as separate codebases that happen to live
in this repo.

---

## poker-mini-app/ (Next.js Farcaster mini-app)

**Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS,
Neynar SDK/Auth, Farcaster Mini App SDK, wagmi/viem (EVM) + Solana wallet
adapter, Turso (libSQL) for the shared multiplayer DB, Vercel KV for
notifications/session state.

### Setup & commands
```bash
cd poker-mini-app
npm install --legacy-peer-deps   # peer deps conflict without this flag
npm run dev                       # http://localhost:3000, via scripts/dev.js
npm run build                     # next build
npm run lint                      # next lint
```
There is no test suite in this project — verify changes via `npm run dev` and
manual exercise of the table flow, plus `npm run build` / `tsc` for type
errors.

### Structure
- `src/app/api/table/route.ts` — **the core game engine**. All poker table
  state (deck/shuffle, blinds schedule, betting rounds, phase transitions
  preflop→flop→turn→river→showdown, AI opponent call/fold heuristic,
  disconnect handling) lives in this single route file. This is the file
  most poker-logic changes touch; read it in full before editing — it is
  large (~750 lines) and the state machine has cross-cutting invariants
  (e.g. `current_turn_fid`, `last_aggressor_fid`, `has_acted` must stay
  consistent across every action branch).
- `src/lib/db.ts` — Turso/libSQL client + schema. Falls back to a local
  SQLite file in the OS temp dir when `TURSO_DATABASE_URL` is unset (so local
  dev works without secrets). Schema changes must go through
  `addMissingColumns(...)` (a manual additive migration helper that
  `ALTER TABLE ADD COLUMN`s idempotently) — **never edit the live schema by
  dropping/recreating tables**, since serverless cold starts must not wipe
  active tables/seats. Duplicate-column errors from this helper are
  expected under concurrent serverless cold starts and are swallowed
  intentionally.
- `src/components/ui/tabs/HomeTab.tsx` — primary game UI (the table view,
  betting controls, seat rendering).
- `src/lib/constants.ts` — app metadata, Farcaster manifest fields,
  `APP_ACCOUNT_ASSOCIATION` (signed Farcaster domain association — treat as
  generated/sensitive, don't hand-edit casually). This file carries a
  scaffold-generated header warning it may be overwritten by an init script;
  in this repo it has since diverged with real production values, so edit it
  directly as needed.
- `src/app/.well-known/farcaster.json/route.ts` + `vercel.json` redirects —
  Farcaster manifest hosting. `vercel.json` currently redirects
  `/.well-known/farcaster.json` to a Farcaster-hosted manifest URL.
- `src/auth.ts`, `src/app/api/auth/*` — NextAuth + Farcaster Quick Auth /
  Neynar SIWN flows.

### Conventions
- Path alias `~/*` maps to `src/*` (see `tsconfig.json`).
- `@typescript-eslint/no-explicit-any` and `no-img-element` are disabled
  project-wide — don't "fix" `any` or `<img>` usage as drive-by cleanup.
- Money/stack values in the table engine are integers (chips), not floats.
- Card encoding is a 2-char string: rank (`2`-`9`,`T`,`J`,`Q`,`K`,`A`) + suit
  (`h`,`d`,`c`,`s`), e.g. `"Ah"`, `"Td"`.

---

## AI-Poker-Coach/ (Python FastAPI backend)

**Stack**: FastAPI, Pydantic, NumPy, Docker (Python 3.11-slim), pluggable LLM
providers (ASI:One / OpenAI / Grok / local Ollama), a custom post-quantum
cryptography (PQC) module.

### Setup & commands
```bash
cd AI-Poker-Coach
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8080
```
Deploys to Render as a Docker web service (root directory `AI-Poker-Coach`,
Dockerfile builds `uvicorn server:app` on port 8080).

### Structure
- `server.py` — FastAPI app, `/api/analyze_action` endpoint; picks default LLM
  provider from env vars at startup (`ASI1_API_KEY` → `asi1`, else
  `OPENAI_API_KEY` → `openai`, else `GROK_API_KEY` → `grok`).
- `ai_processor.py` / `ai_router.py` — LLM provider abstraction and routing.
- `equity_sim.py` — Monte Carlo equity simulation (`range_vs_range`, etc.).
- `nash_train.py`, `poker_engine.py` — CFR/GTO mathematical models.
- `dossier_manager.py`, `vector_store/` — player "dossier" persistence and
  embedding-based retrieval (note: `sentence-transformers` was deliberately
  removed from `requirements.txt` to fix Render free-tier OOM — don't
  reintroduce heavy embedding model deps without checking memory budget).
- `pqc.py`, `pqc_api.py`, `pqc_files.py` — post-quantum crypto toolkit
  (ML-KEM/ML-DSA via `quantcrypt`, hybrid AES-GCM encryption). See
  `AI-Poker-Coach/.github/copilot-instructions.md` for the detailed
  conventions on this subsystem (docstring format, import-guard pattern,
  key storage paths) — read it before touching anything under `pqc*`.
- `config/models.json` — provider endpoints, token limits, and routing rules
  (which hands get "deep" vs "light" analysis based on pot size/tags).

### Conventions
- Modules support dual usage (package import and direct script execution) via
  `try/except ImportError` fallback imports — preserve this pattern, don't
  delete the guard.
- Strict type hints on all function signatures.
- Never hardcode API keys; they come from environment variables named in
  `config/models.json`'s `api_key_env` fields.

---

## LeakSnipe/ (Desktop OCR HUD + hand-history tracker)

**Stack**: Tauri v2 (Rust shell) + React/TypeScript UI (`leaksnipe-ui/`) +
Python FastAPI sidecar (`sidecar/`, port 8765) + a legacy CustomTkinter
Python GUI (`poker_gui.py`) kept as a fallback/primary live-HUD overlay.

This subproject has its own detailed agent notes at `LeakSnipe/AGENTS.md` —
**read that file before making any change here**, it encodes many
non-obvious, hard-won decisions (canonical app is `leaksnipe-ui/` + sidecar,
not the older `leak-snipe-desktop/` or `PokerBuild/poker-trainer/` scaffolds;
live HUD must stay the Python `poker_gui.py --live-hud` overlay, not the
experimental Tauri overlay; AI layer must prefer ASI:One over local Ollama
when keys are present; etc.). Do not re-derive these decisions from scratch —
treat `AGENTS.md` there as the source of truth and keep it updated if you
make a decision worth remembering for next time.

Key paths: `models.py`, `parsers.py`, `analysis.py`, `equity.py` (Monte Carlo
equity for NLHE/Omaha-8/stud), `theory/` (CFR+ solver, neural value net),
`sidecar/server.py` (FastAPI), `leaksnipe-ui/src-tauri/` (Tauri/Rust shell).

---

## Poker-COACH/ (two unrelated things sharing one directory)

This directory contains **two unrelated codebases**:
1. `src/`, `tests/` — a Vue.js poker hand analysis component
   (`PokerHandAnalysis.vue`, `pokerHandAnalysis.js` API client, Vuex store).
   Tests live in `tests/unit/**/*.spec.js`.
2. Everything else at the top level (`advent_of_code.py`, `pyproject.toml`,
   the `.github/workflows/*advent*` files, `README.md`) — a fully autonomous
   "Advent of Code" bot pipeline driven by `sourcery-ai[bot]`, unrelated to
   poker. Python tooling here uses `uv` (`uv.lock` present), `ruff` (strict,
   `select = ["ALL"]`), and `mypy --strict`.

Don't conflate the two — check which one a task actually concerns before
editing.

---

## poker-snap/ (Farcaster Snap agent)

**Stack**: Hono on Vercel Edge runtime, TypeScript ESM, `pnpm`, Turso via
`@farcaster/snap-turso`.

```bash
cd poker-snap
pnpm install
pnpm dev       # http://localhost:3003
pnpm build     # tsc --noEmit — ALWAYS run before deploying
```

Critical convention (documented in `poker-snap/AGENTS.md`): this is an ESM
project with `moduleResolution: "NodeNext"` — **every relative import must
include the `.js` extension** (e.g. `import { x } from "./thing.js"`), even
though source files are `.ts`. Omitting the extension passes under `tsx` in
local dev but fails on Vercel deploy with `500 FUNCTION_INVOCATION_FAILED`.
`pnpm build` (`tsc --noEmit`) catches this at build time — run it before any
deploy.

`src/index.ts` is the Hono app entry (edit this for route/handler changes);
`src/server.ts` is only the local dev server wrapper.

---

## General conventions for this repo

- **Never assume a shared toolchain.** `poker-mini-app` uses npm,
  `poker-snap` uses pnpm, `LeakSnipe`/`AI-Poker-Coach`/`Poker-COACH`'s AoC
  half use Python (`pip`/`uv`), `Poker-COACH`'s Vue half is its own npm
  project. Always check the specific subproject's lockfile/config before
  picking a package manager.
- **Secrets**: never commit `.env*`, `env.yaml`, or files under `Secrets/` —
  see root `.gitignore`. Each subproject's `.env.example`/`.env.template`
  documents the variables it expects.
- **Database migrations are additive-only** in both `poker-mini-app`
  (`addMissingColumns` in `src/lib/db.ts`) and the general philosophy across
  this repo: production tables (Turso) must never be dropped/recreated by
  app code, since multiple serverless instances can race on cold start.
- **Per-subproject agent notes take precedence.** Where a subproject has its
  own `AGENTS.md` or `.github/copilot-instructions.md`
  (`LeakSnipe/AGENTS.md`, `poker-snap/AGENTS.md`,
  `AI-Poker-Coach/.github/copilot-instructions.md`), treat those as more
  specific and authoritative than this file for that subproject, and keep
  them updated when you learn something new while working there.
