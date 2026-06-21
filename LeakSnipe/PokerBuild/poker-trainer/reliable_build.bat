@echo off
setlocal enabledelayedexpansion

echo ==========================================
echo      POKER THERAPIST CLEAN BUILDER
echo ==========================================

echo [1/5] Renaming old node_modules to avoid locks...
if exist node_modules (
    rename node_modules node_modules_old_%RANDOM%
    if exist node_modules (
        echo Warning: Could not rename node_modules. Some files might be locked.
        echo Attempting to install over existing modules...
    ) else (
        echo Success: Old modules moved aside.
    )
)

echo [2/5] Cleaning artifacts...
if exist dist rmdir /s /q dist
if exist dist-electron rmdir /s /q dist-electron
if exist release rmdir /s /q release

echo [3/5] Installing dependencies (NPM)...
call npm install --no-audit

echo [4/5] Building project...
call npm run build
call npx esbuild electron/main.ts --bundle --platform=node --format=esm --target=node18 --outfile=dist-electron/main.js --external:electron --external:better-sqlite3 --external:chokidar --external:get-windows --external:mock-aws-s3 --external:aws-sdk --external:nock
call npx esbuild electron/preload.ts --bundle --platform=node --format=cjs --target=node18 --outfile=dist-electron/preload.js --external:electron

echo [5/5] Packaging Portable Executable...
set ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true
call npx electron-builder --win portable

echo.
echo ==========================================
echo Build process finished.
echo Checking for 'Poker Therapist.exe' in release/ dir...
if exist "release\Poker Therapist.exe" (
    copy /Y "release\Poker Therapist.exe" "Poker Therapist.exe"
    echo SUCCESS: 'Poker Therapist.exe' created in root folder.
    echo You can now run it!
) else (
    if exist "release\*.exe" (
        for %%f in ("release\*.exe") do (
            copy /Y "%%f" "Poker Therapist.exe"
            echo SUCCESS: Found "%%f" and copied to root as 'Poker Therapist.exe'
        )
    ) else (
        echo ERROR: No executable found in release folder.
        echo Please check the output above for errors.
    )
)

pause
