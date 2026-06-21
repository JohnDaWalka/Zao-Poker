@echo off
echo Starting Poker Therapist...
cd /d "%~dp0"
call pnpm install
call pnpm run dev
pause