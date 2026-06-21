@echo off
setlocal

echo [1/6] Setting up manual release folder...
if exist "Poker Therapist Manual" rmdir /s /q "Poker Therapist Manual"
mkdir "Poker Therapist Manual"

echo [2/6] Copying Electron runtime...
xcopy "node_modules\electron\dist\*" "Poker Therapist Manual\" /E /H /Y /Q

echo [3/6] Renaming executable...
rename "Poker Therapist Manual\electron.exe" "Poker Therapist.exe"

echo [4/6] Creating resources/app...
mkdir "Poker Therapist Manual\resources\app"

echo [5/6] Copying application files...
xcopy "dist\*" "Poker Therapist Manual\resources\app\dist\" /E /H /Y /Q
xcopy "dist-electron\*" "Poker Therapist Manual\resources\app\dist-electron\" /E /H /Y /Q
copy "package.json" "Poker Therapist Manual\resources\app\" /Y

echo [6/6] Copying dependencies (might take a while)...
REM Only copy production dependencies if possible, but copying full node_modules is safer for now
xcopy "node_modules\*" "Poker Therapist Manual\resources\app\node_modules\" /E /H /Y /Q /EXCLUDE:exclude_list.txt

echo.
echo SUCCESS: Manual build complete.
echo Run 'Poker Therapist Manual\Poker Therapist.exe' to start.
pause
