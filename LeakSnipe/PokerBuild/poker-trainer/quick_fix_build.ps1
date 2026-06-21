Write-Host "Reinstalling Electron..."
npm install electron --save-dev --force

Write-Host "Building Frontend..."
npm run build

Write-Host "Compiling Main Process..."
npx tsc

Write-Host "Packaging with electron-packager..."
# Simplified packaging command
npx electron-packager . "Poker Therapist" --platform=win32 --arch=x64 --out=release-packager --overwrite --icon=public/icon.ico --ignore="^\/(dist|dist-electron|release|release_.*|node_modules|src|public|electron)$"

if (Test-Path "release-packager/Poker Therapist-win32-x64/Poker Therapist.exe") {
    Write-Host "SUCCESS: Application packaged in release-packager/"
    
    # Copy to root as requested (folder)
    if (Test-Path "Poker Therapist") { Remove-Item "Poker Therapist" -Recurse -Force }
    Copy-Item "release-packager/Poker Therapist-win32-x64" -Destination "Poker Therapist" -Recurse
    
    # Create shortcut/launcher
    $launcher = @"
@echo off
start "" "Poker Therapist\Poker Therapist.exe"
"@
    Set-Content "Launch Poker Therapist.bat" $launcher
    
    Write-Host "Created 'Poker Therapist' folder and 'Launch Poker Therapist.bat' in root."
} else {
    Write-Error "Packaging failed."
}
