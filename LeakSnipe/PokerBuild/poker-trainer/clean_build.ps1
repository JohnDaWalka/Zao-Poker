Write-Host "Updating dependencies (npm)..."
npm install

Write-Host "Checking frontend build..."
if (-not (Test-Path "dist/index.html")) {
    Write-Host "Building frontend..."
    npm run build
}

Write-Host "Bundling main process..."
npx esbuild electron/main.ts --bundle --platform=node --format=esm --target=node18 --outfile=dist-electron/main.js --external:electron --external:better-sqlite3 --external:chokidar --external:get-windows --external:mock-aws-s3 --external:aws-sdk --external:nock

Write-Host "Bundling preload process..."
npx esbuild electron/preload.ts --bundle --platform=node --format=cjs --target=node18 --outfile=dist-electron/preload.js --external:electron

# Use unique output dir
$timestamp = Get-Date -Format "HHmmss"
$outputDir = "release_npm_$timestamp"

Write-Host "Packaging (portable) to $outputDir..."
$env:ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES="true"
# Removing CSC bypass to see if strict signing was issue, or just keep it safer
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"

npx electron-builder --win portable --config.directories.output="$outputDir"

Write-Host "Checking for output..."
if (Test-Path "$outputDir") {
    $exe = (Get-ChildItem -Path "$outputDir" -Filter "*.exe" -Recurse | Select-Object -First 1).FullName
    if ($exe) {
        Write-Host "Found exe: $exe"
        Copy-Item $exe -Destination "Poker Therapist.exe" -Force
        Write-Host "Copied to root successfully."
    } else {
        Write-Error "No exe found in $outputDir."
    }
} else {
    Write-Error "$outputDir not created."
}
