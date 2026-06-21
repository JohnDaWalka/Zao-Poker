Write-Host "Starting Unified Build for Custom Poker System (Electron Only)..." -ForegroundColor Green

# Build Electron Frontend & Package
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

Write-Host "Build Complete! Installer is in C:\Users\mfane\poker-trainer\release\win-unpacked" -ForegroundColor Green
