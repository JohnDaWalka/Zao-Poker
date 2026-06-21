@echo off
setlocal enabledelayedexpansion

echo [1/5] Finding electron runtime...
set "SOURCE_DIR="
for /d %%d in (release_npm_*) do (
    if exist "%%d\win-unpacked\electron.exe" set "SOURCE_DIR=%%d\win-unpacked"
)

if "%SOURCE_DIR%"=="" (
    echo Error: Could not find build output with electron.exe.
    echo Please run reliable_build.bat first!
    pause
    exit /b 1
)
echo Found runtime at: %SOURCE_DIR%

echo [2/5] Creating manual release folder...
if exist "Poker Therapist Manual" rmdir /s /q "Poker Therapist Manual"
mkdir "Poker Therapist Manual"
xcopy "%SOURCE_DIR%\*" "Poker Therapist Manual\" /E /H /Y /Q

echo [3/5] Setting up application...
rename "Poker Therapist Manual\electron.exe" "Poker Therapist.exe"
mkdir "Poker Therapist Manual\resources\app"

echo [4/5] Copying code...
xcopy "dist\*" "Poker Therapist Manual\resources\app\dist\" /E /H /Y /Q
xcopy "dist-electron\*" "Poker Therapist Manual\resources\app\dist-electron\" /E /H /Y /Q
copy "package.json" "Poker Therapist Manual\resources\app\" /Y

echo [5/5] Copying dependencies (this is large)...
xcopy "node_modules\*" "Poker Therapist Manual\resources\app\node_modules\" /E /H /Y /Q /EXCLUDE:exclude_list.txt

echo.
echo SUCCESS: Created 'Poker Therapist Manual\Poker Therapist.exe'
echo Double-click that file to run the app.
pause
