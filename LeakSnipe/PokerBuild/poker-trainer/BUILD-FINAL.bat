@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0build-release.ps1"
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b 1
)
echo Build completed successfully! Check release/win-unpacked
pause
