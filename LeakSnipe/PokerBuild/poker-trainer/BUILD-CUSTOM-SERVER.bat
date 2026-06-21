@echo off
title Build Custom Poker Server

echo Building Backend Tracker...
cd C:\Users\mfane\poker-tracker-go
echo Installing dependencies...
go get github.com/mattn/go-sqlite3
echo Compiling...
go build -o custom-poker-server.exe main.go

if exist custom-poker-server.exe (
    echo Backend build successful!
) else (
    echo Backend build failed. Please check Go installation.
    pause
    exit /b
)

echo Building Frontend...
cd C:\Users\mfane\poker-trainer
call npm install
call npm run build

echo.
echo Build Complete!
echo You can now run "START-CUSTOM-SERVER.bat" to launch the system.
pause