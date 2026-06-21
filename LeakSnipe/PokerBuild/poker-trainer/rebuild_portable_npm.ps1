# Force kill any lingering processes
taskkill /F /IM electron.exe /T 2>$null
taskkill /F /IM "Poker Therapist.exe" /T 2>$null

# Try to move bad node_modules out of the way
if (Test-Path "node_modules") {
    $trash = "node_modules_trash_" + (Get-Date -Format "HHmmss")
    Rename-Item "node_modules" $trash -ErrorAction SilentlyContinue
}

# Install dependencies with NPM (more stable than pnpm in some envs)
Write-Host "Installing dependencies..."
npm install --no-audit --prefer-offline

# Build Frontend
Write-Host "Building Frontend..."
npm run build

# Build Backend (esbuild)
Write-Host "Building Backend..."
npx esbuild electron/main.ts --bundle --platform=node --format=cjs --target=node18 --outfile=dist-electron/main.js --external:electron --external:better-sqlite3 --external:chokidar --external:get-windows --external:mock-aws-s3 --external:aws-sdk --external:nock
npx esbuild electron/preload.ts --bundle --platform=node --format=cjs --target=node18 --outfile=dist-electron/preload.js --external:electron

# Package Portable
Write-Host "Packaging Portable App..."
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npx electron-builder --win portable --config.directories.output="release_final"

# Check and Move
if (Test-Path "release_final") {
    $exe = (Get-ChildItem -Path "release_final" -Filter "*.exe" -File | Select-Object -First 1).FullName
    if ($exe) {
        Write-Host "Found Valid Portable EXE: $exe"
        Copy-Item $exe -Destination "Poker Therapist.exe" -Force
        Write-Host "SUCCESS: Poker Therapist.exe created in root."
    } else {
        Write-Error "Portable build failed to create .exe file in release_final (only unpacked folder found?)"
        
        # Fallback: Copy unpacked folder content to a 'Start' folder and create a bat launcher
        $unpacked = "release_final\win-unpacked"
        if (Test-Path $unpacked) {
            Write-Warning "Falling back to unpacked build."
            if (Test-Path "PokerTherapistApp") { Remove-Item "PokerTherapistApp" -Recurse -Force }
            Copy-Item $unpacked -Destination "PokerTherapistApp" -Recurse
            
            # Create Launcher
            $launcher = @"
@echo off
start "" "PokerTherapistApp\electron.exe"
"@
            Set-Content "Start Poker Therapist.bat" $launcher
            Write-Host "Created 'Start Poker Therapist.bat' and 'PokerTherapistApp' folder."
        }
    }
}
