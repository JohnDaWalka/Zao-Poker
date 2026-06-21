# Custom Server Poker System Setup

## 1. Build the System
Double-click `C:\Users\mfane\BUILD-CUSTOM-SERVER.bat`.
This will:
- Download Go dependencies.
- Compile the backend tracker (`custom-poker-server.exe`).
- Build the frontend interface.

## 2. Run the System
Double-click `C:\Users\mfane\START-CUSTOM-SERVER.bat`.
This will:
- Launch the backend tracker (syncing DriveHUD2 -> OneDrive).
- Launch the frontend interface (HUD + AI).

## 3. Configuration
- Backend Logic: `C:\Users\mfane\poker-tracker-go\main.go`
- AI Logic: `C:\Users\mfane\poker-trainer\electron\analysis\`
- Database: `C:\Users\mfane\OneDrive\PokerHandHistories\poker_hands.db`
