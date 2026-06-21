Write-Host "Starting Unified Build for Custom Poker System..." -ForegroundColor Green

# 1. Build Go Backend
Write-Host "Building Go Backend (custom-poker-server.exe)..."
Set-Location "C:\Users\mfane\poker-tracker-go"
go build -o custom-poker-server.exe .
if ($LASTEXITCODE -ne 0) {
    Write-Error "Go build failed!"
    exit 1
}
Write-Host "Go Backend Built Successfully."

# Copy to root just in case (optional, but good for local dev)
Copy-Item "custom-poker-server.exe" "..\poker-trainer\custom-poker-server.exe" -Force

# 2. Build Electron Frontend & Package
Write-Host "Building Electron App..."
Set-Location "C:\Users\mfane\poker-trainer"

# Install dependencies if needed
if (!(Test-Path "node_modules")) {
    Write-Host "Installing npm dependencies..."
    npm install
}

# Run the package script (npm run build && electron-builder)
Write-Host "Packaging Application..."
npm run package

if ($LASTEXITCODE -ne 0) {
    Write-Error "Electron packaging failed!"
    exit 1
}

Write-Host "Build Complete! Installer is in C:\Users\mfane\poker-trainer\release" -ForegroundColor Green
