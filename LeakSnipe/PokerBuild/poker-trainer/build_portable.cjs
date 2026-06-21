const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const timestamp = new Date().toISOString().replace(/[:T\.-]/g, '').slice(0,14);
const outputDir = path.join(rootDir, `release_${timestamp}`);

console.log(`Starting portable build... Output: ${outputDir}`);

try {
    // 1. Build frontend
    console.log('Building frontend...');
    execSync('pnpm run build', { stdio: 'inherit' });

    // 2. Build backend
    console.log('Building backend...');
    execSync('npx esbuild electron/main.ts --bundle --platform=node --format=esm --target=node18 --outfile=dist-electron/main.js --external:electron --external:better-sqlite3 --external:chokidar --external:get-windows --external:mock-aws-s3 --external:aws-sdk --external:nock', { stdio: 'inherit' });
    execSync('npx esbuild electron/preload.ts --bundle --platform=node --format=cjs --target=node18 --outfile=dist-electron/preload.js --external:electron', { stdio: 'inherit' });

    // 3. Package
    console.log(`Packaging to ${outputDir}...`);
    // Note: --config.directories.output overrides directory in package.json
    execSync(`npx electron-builder --win portable --config.directories.output="${outputDir}"`, { stdio: 'inherit' });

    // 4. Move exe
    console.log('Moving executable...');
    const files = fs.readdirSync(outputDir);
    const exeFile = files.find(f => f.endsWith('.exe'));
    
    if (exeFile) {
        const source = path.join(outputDir, exeFile);
        const dest = path.join(rootDir, 'Poker Therapist.exe');
        
        // Try to remove destination if exists
        if (fs.existsSync(dest)) {
            try {
                fs.unlinkSync(dest);
            } catch (e) {
                console.error(`Warning: Could not delete existing ${dest}. It might be in use.`);
            }
        }
        
        fs.copyFileSync(source, dest);
        console.log(`SUCCESS: Created ${dest}`);
    } else {
        console.error('Error: No .exe found in output directory');
        process.exit(1);
    }
    
    // 5. Cleanup
    try {
        // fs.rmSync(outputDir, { recursive: true, force: true });
        console.log(`Cleanup: Removed ${outputDir}`);
    } catch (e) {
        console.warn(`Warning: Could not remove temporary directory ${outputDir}`);
    }

} catch (e) {
    console.error('Build failed:', e.message);
    process.exit(1);
}
