Write-Host "Installing packager dependencies..."
npm install electron-packager electron --save-dev --force

Write-Host "Building project..."
npm run build

Write-Host "Compiling main process..."
npx tsc

Write-Host "Packaging Application (Folder)..."
# Ignore development and build artifacts
npx electron-packager . "Poker Therapist" --platform=win32 --arch=x64 --out=release-folder --overwrite --icon=public/icon.ico --ignore="^\/(dist|dist-electron|release|release_.*|node_modules|src|public|electron)$"

if (Test-Path "release-folder/Poker Therapist-win32-x64/Poker Therapist.exe") {
    Write-Host "Checking resource integrity..."
    if (Test-Path "release-folder/Poker Therapist-win32-x64/resources/app") {
        Write-Host "Resources found (app folder)."
    }
    elseif (Test-Path "release-folder/Poker Therapist-win32-x64/resources/app.asar") {
        Write-Host "Resources found (asar)."
    }
    else {
        Write-Warning "Potentially missing resources in packaged app."
    }

    Write-Host "Moving to root..."
    if (Test-Path "Poker Therapist App") { Remove-Item "Poker Therapist App" -Recurse -Force }
    Move-Item "release-folder/Poker Therapist-win32-x64" "Poker Therapist App"
    
    # Create Launcher
    $launcher = @"
@echo off
start "" "Poker Therapist App\Poker Therapist.exe"
"@
    Set-Content "Launch Poker Therapist.bat" $launcher
    
    Write-Host "SUCCESS: Created 'Poker Therapist App' folder and launcher."
}
else {
    Write-Error "Hardware packaging failed."
}
