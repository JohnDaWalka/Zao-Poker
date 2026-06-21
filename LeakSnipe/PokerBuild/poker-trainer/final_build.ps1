# Final reliable build script
$ErrorActionPreference = "Stop"

Write-Host "Starting final build process..."

# 1. Install dependencies cleanly (bypass pnpm issues)
if (Test-Path "package-lock.json") { Remove-Item "package-lock.json" -Force }
# if (Test-Path "node_modules") { Remove-Item "node_modules" -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "Installing dependencies..."
cmd /c "npm install --no-audit 2>&1"

# 2. Build code
Write-Host "Building project..."
cmd /c "npm run build 2>&1"

# 3. Package
$outputDir = "release_final"
if (Test-Path $outputDir) { Remove-Item $outputDir -Recurse -Force }

Write-Host "Packaging Portable Executable..."
# Force portable target and explicit artifact name
cmd /c "npx electron-builder --win portable --config.directories.output=$outputDir --config.win.artifactName='PokerTherapist_Portable.exe' 2>&1"

# 4. output check
if (Test-Path "$outputDir/PokerTherapist_Portable.exe") {
    Copy-Item "$outputDir/PokerTherapist_Portable.exe" -Destination "Poker Therapist.exe" -Force
    Write-Host "SUCCESS: Created 'Poker Therapist.exe' in root folder."
} else {
    Write-Warning "Portable build failed. Trying unpacked build..."
    cmd /c "npx electron-builder --win dir --config.directories.output=$outputDir 2>&1"
    
    if (Test-Path "$outputDir/win-unpacked") {
        # Create a Launch.bat because running exe directly fails without dlls
        $batContent = "@echo off`nstart `"Poker Therapist`" `"%~dp0$outputDir\win-unpacked\Poker Therapist.exe`""
        Set-Content "Launch Final App.bat" $batContent
        Write-Host "Created 'Launch Final App.bat' which runs the unpacked app."
        
        # Also try to create a shortcut if possible (powershell magic)
        $WshShell = New-Object -comObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut("$PWD\Poker Therapist Shortcut.lnk")
        $Shortcut.TargetPath = "$PWD\$outputDir\win-unpacked\Poker Therapist.exe"
        $Shortcut.Save()
        Write-Host "Created Shortcut in root."
    }
}
