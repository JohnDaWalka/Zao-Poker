# debug_build.ps1
Write-Host "Starting debug build process..."

# 1. Clean previous build artifacts
if (Test-Path "release") { Remove-Item "release" -Recurse -Force }
if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
if (Test-Path "dist-electron") { Remove-Item "dist-electron" -Recurse -Force }

# 2. Reinstall dependencies to ensure native modules are correct
Write-Host "Reinstalling dependencies..."
pnpm install

# 3. Build the application
Write-Host "Building application..."
pnpm run build 
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed!"
    exit 1
}

# 4. Package application (unpacked for debugging)
Write-Host "Packaging application (unpacked)..."
pnpm exec electron-builder --win --x64 --dir

if ($LASTEXITCODE -eq 0) {
    Write-Host "Build successful!"
    Write-Host "You can find the executable at: release/win-unpacked/Poker Therapist.exe"
    Write-Host "Please try running this executable and report any errors."
}
else {
    Write-Error "Packaging failed!"
}
