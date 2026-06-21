# Build script for poker-trainer
Write-Host "Starting build process..."
Write-Host "Current directory: $(Get-Location)"
Write-Host "Node version: $(node --version)"
Write-Host "npm version: $(npm --version)"

# Step 1: pnpm install
Write-Host "`n=== Step 1: Install dependencies ==="
pnpm install --no-frozen-lockfile
if ($LASTEXITCODE -ne 0) {
    Write-Host "Install failed with exit code $LASTEXITCODE"
    exit 1
}
Write-Host "Install completed successfully"

# Step 2: Build
Write-Host "`n=== Step 2: Build with pnpm ==="
pnpm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed with exit code $LASTEXITCODE"
    exit 1
}
Write-Host "Build completed successfully"

# Step 3: Create exe with electron-builder
Write-Host "`n=== Step 3: Build electron app ==="
npx electron-builder --win portable
if ($LASTEXITCODE -ne 0) {
    Write-Host "Electron build failed with exit code $LASTEXITCODE"
    exit 1
}
Write-Host "Electron build completed successfully"

# Step 4: Report results
Write-Host "`n=== Build Results ==="
$exeFile = Get-ChildItem -Path "C:\PokerBuild\poker-trainer\release\*.exe" | Select-Object -First 1
if ($exeFile) {
    Write-Host "EXE File: $($exeFile.FullName)"
    Write-Host "Size: $($exeFile.Length) bytes ($([math]::Round($exeFile.Length/1MB, 2)) MB)"
} else {
    Write-Host "No EXE file found in release folder"
}
