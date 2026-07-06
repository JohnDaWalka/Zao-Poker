// ---------------------------------------------------------------------------
// Local tunnel for Farcaster Mini App testing
// Usage: node scripts/tunnel.mjs [port]
// 
// Prefers Cloudflare tunnel (no account needed) then falls back to ngrok.
// ---------------------------------------------------------------------------

import { spawn } from 'child_process';
import { createServer } from 'net';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

dotenv.config({ path: '.env.local' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(path.normalize(path.join(__dirname, '..')));

const args = process.argv.slice(2);
let port = 3000;

// Parse port argument
args.forEach((arg, index) => {
  if (arg.startsWith('--port=')) {
    port = parseInt(arg.split('=')[1]);
  } else if (arg === '--port' && args[index + 1]) {
    port = parseInt(args[index + 1]);
  } else if (arg.startsWith('-p=')) {
    port = parseInt(arg.split('=')[1]);
  } else if (arg === '-p' && args[index + 1]) {
    port = parseInt(args[index + 1]);
  } else if (/^\d+$/.test(arg)) {
    port = parseInt(arg);
  }
});

async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

async function findAvailablePort(startPort) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = startPort + attempt;
    if (!(await isPortInUse(candidate))) {
      return candidate;
    }
  }
  return null;
}

async function checkCommand(cmd) {
  try {
    await execAsync(`${cmd} --version`);
    return true;
  } catch {
    return false;
  }
}

async function startTunnel() {
  const availablePort = await findAvailablePort(port);
  if (!availablePort) {
    console.error(`❌ Could not find an available port between ${port} and ${port + 9}.`);
    process.exit(1);
  }
  port = availablePort;

  const localUrl = `http://localhost:${port}`;
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║           ZAO Poker — Farcaster Mini App Tunnel                     ║
╚══════════════════════════════════════════════════════════════════════╝
`);
  
  console.log(`📍 Local server: ${localUrl}`);
  console.log(`🔍 Checking for tunnel tools...\n`);

  // Check if Next.js is running on that port
  const nextRunning = await isPortInUse(port);
  if (!nextRunning) {
    console.log(`⚠️  No Next.js dev server detected on port ${port}.`);
    console.log(`   Start it first: npm run dev\n`);
  }

  // Try Cloudflare first (no account needed)
  const hasCloudflared = await checkCommand('cloudflared');
  const hasNgrok = await checkCommand('ngrok');

  let tunnelUrl = null;
  let tunnelProcess = null;

  if (hasCloudflared) {
    console.log(`✅ Using Cloudflare tunnel (no account required)\n`);
    
    const cf = spawn('cloudflared', ['tunnel', '--url', localUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    tunnelProcess = cf;
    
    cf.stdout.on('data', (data) => {
      const str = data.toString();
      const match = str.match(/https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/);
      if (match && !tunnelUrl) {
        tunnelUrl = match[0];
        printSuccess(tunnelUrl, localUrl);
      }
      process.stdout.write(str);
    });
    
    cf.stderr.on('data', (data) => {
      const str = data.toString();
      const match = str.match(/https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/);
      if (match && !tunnelUrl) {
        tunnelUrl = match[0];
        printSuccess(tunnelUrl, localUrl);
      }
      process.stderr.write(str);
    });

  } else if (hasNgrok) {
    console.log(`✅ Using ngrok tunnel\n`);
    
    const ngrok = spawn('ngrok', ['http', port.toString()], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    tunnelProcess = ngrok;
    
    ngrok.stdout.on('data', (data) => {
      const str = data.toString();
      const match = str.match(/https:\/\/[a-zA-Z0-9\-]+\.ngrok-free\.app/);
      if (match && !tunnelUrl) {
        tunnelUrl = match[0];
        printSuccess(tunnelUrl, localUrl);
      }
      process.stdout.write(str);
    });
    
    ngrok.stderr.on('data', (data) => {
      const str = data.toString();
      const match = str.match(/https:\/\/[a-zA-Z0-9\-]+\.ngrok-free\.app/);
      if (match && !tunnelUrl) {
        tunnelUrl = match[0];
        printSuccess(tunnelUrl, localUrl);
      }
      process.stderr.write(str);
    });

  } else {
    console.log(`❌ No tunnel tool found. Install one of the following:\n`);
    console.log(`   Option 1 (recommended, no account): Cloudflare`);
    console.log(`      Windows: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
    console.log(`      Mac:     brew install cloudflared`);
    console.log(`      Linux:   sudo apt install cloudflared\n`);
    console.log(`   Option 2: ngrok`);
    console.log(`      https://ngrok.com/download\n`);
    process.exit(1);
  }

  // Cleanup
  const cleanup = () => {
    if (tunnelProcess) {
      console.log('\n🛑 Stopping tunnel...');
      tunnelProcess.kill('SIGTERM');
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function printSuccess(tunnelUrl, localUrl) {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🌐 TUNNEL ACTIVE                                                    ║
╚══════════════════════════════════════════════════════════════════════╝

   Public URL:  ${tunnelUrl}
   Local URL:   ${localUrl}

───────────────────────────────────────────────────────────────────────

🧪  TEST YOUR MINI APP:

   1. Farcaster Previewer:
      https://farcaster.xyz/~/developers/mini-apps/preview?url=${encodeURIComponent(tunnelUrl)}

   2. Warpcast Developer Tools:
      https://farcaster.xyz/~/developers/

   3. In-app Tester (open this URL in browser):
      ${tunnelUrl}/tester

📋  PRE-DEPLOY CHECKLIST:
   ☐ Farcaster manifest loads:   ${tunnelUrl}/.well-known/farcaster.json
   ☐ API responds:               ${tunnelUrl}/api/table
   ☐ In-app tester passes:       ${tunnelUrl}/tester
   ☐ Splash screen shows
   ☐ SDK actions work in preview

───────────────────────────────────────────────────────────────────────
`);
}

startTunnel().catch(console.error);
