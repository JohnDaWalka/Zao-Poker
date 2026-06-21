@echo off
echo Installing dependencies...
call pnpm install
if %errorlevel% neq 0 exit /b %errorlevel%

echo Building app...
call npx tsc
if %errorlevel% neq 0 exit /b %errorlevel%
call npx vite build
if %errorlevel% neq 0 exit /b %errorlevel%

echo Packaging app...
call npx electron-builder --win --x64 --dir
if %errorlevel% neq 0 exit /b %errorlevel%

echo Build complete. Launching...
start "" "release\win-unpacked\Poker Therapist.exe"
