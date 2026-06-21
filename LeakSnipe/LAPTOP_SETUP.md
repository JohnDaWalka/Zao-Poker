# LeakSnipe — Laptop Setup

## Clone

```powershell
git clone https://github.com/gitgoin87/LeakSnipe.git
cd LeakSnipe
```

## Python environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

## System dependencies (Windows)

1. **Tesseract OCR** — https://github.com/UB-Mannheim/tesseract/wiki  
   Default path: `C:\Program Files\Tesseract-OCR\tesseract.exe`

2. **API keys (optional)** — copy `.env.template` to `.env` and set:
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`

## Run

```powershell
python poker_gui.py
```

Or double-click `LaunchPokerTracker.bat`.

## First launch

1. Open **Settings** and add hand-history folders for your sites (ACR, CoinPoker, etc.).
2. Set your **hero name** per site.
3. Set **db_path** to a local path (default: `poker_hands.db` in the repo folder).

## Replay Poker capture

1. In LeakSnipe: start the **OCR capture bridge** (`http://127.0.0.1:16888`).
2. In the Replay Poker browser tab: open DevTools console, paste and run `replay_bridge_capture.js`.
3. Or use **Capture Replay Window** in the app (requires `pywin32`).
