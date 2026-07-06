import { spawn } from 'child_process';
import { createServer } from 'net';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config({ path: '.env.local' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(path.normalize(path.join(__dirname, '..')));

let nextDev;
let isCleaningUp = false;

// Parse command line arguments for port
const args = process.argv.slice(2);
let port = 3000; // default port

// Look for --port=XXXX, --port XXXX, -p=XXXX, or -p XXXX
args.forEach((arg, index) => {
  if (arg.startsWith('--port=')) {
    port = parseInt(arg.split('=')[1]);
  } else if (arg === '--port' && args[index + 1]) {
    port = parseInt(args[index + 1]);
  } else if (arg.startsWith('-p=')) {
    port = parseInt(arg.split('=')[1]);
  } else if (arg === '-p' && args[index + 1]) {
    port = parseInt(args[index + 1]);
  }
});

async function checkPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    
    server.once('error', () => {
      resolve(true); // Port is in use
    });
    
    server.once('listening', () => {
      server.close();
      resolve(false); // Port is free
    });
    
    server.listen(port);
  });
}

async function killProcessOnPort(port) {
  try {
    if (process.platform === 'win32') {
      // Windows: Use netstat to find the process
      const netstat = spawn('netstat', ['-ano', '|', 'findstr', `:${port}`]);
      netstat.stdout.on('data', (data) => {
        const match = data.toString().match(/\s+(\d+)$/);
        if (match) {
          const pid = match[1];
          spawn('taskkill', ['/F', '/PID', pid]);
        }
      });
      await new Promise((resolve) => netstat.on('close', resolve));
    } else {
      // Unix-like systems: Use lsof
      const lsof = spawn('lsof', ['-ti', `:${port}`]);
      lsof.stdout.on('data', (data) => {
        data.toString().split('\n').forEach(pid => {
          if (pid) {
            try {
              process.kill(parseInt(pid), 'SIGKILL');
            } catch (e) {
              if (e.code !== 'ESRCH') throw e;
            }
          }
        });
      });
      await new Promise((resolve) => lsof.on('close', resolve));
    }
  } catch (e) {
    // Ignore errors if no process found
  }
}

async function startDev() {
  // Port cascade: try the requested port, then up to 10 successive ports
  const startPort = port;
  const maxAttempts = 10;
  let selectedPort = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = startPort + attempt;
    const isPortInUse = await checkPort(candidate);
    if (!isPortInUse) {
      selectedPort = candidate;
      break;
    }
    console.log(`Port ${candidate} is in use, trying next...`);
  }

  if (selectedPort === null) {
    console.error(`Could not find an available port between ${startPort} and ${startPort + maxAttempts - 1}.`);
    process.exit(1);
  }

  port = selectedPort;
  const miniAppUrl = `http://localhost:${port}`;
  console.log(`Using port ${port}`);

  console.log(`
💻 Your mini app is running at: ${miniAppUrl}

🌐 To test with the Farcaster preview tool:

   1. Create a free ngrok account at https://ngrok.com/download/mac-os
   2. Download and install ngrok following the instructions
   3. In a NEW terminal window, run: ngrok http ${port}
   4. Copy the forwarding URL (e.g., https://xxxx-xx-xx-xx-xx.ngrok-free.app)
   5. Navigate to: https://farcaster.xyz/~/developers/mini-apps/preview
   6. Enter your ngrok URL and click "Preview" to test your mini app
`)
  
  // Start next dev with appropriate configuration
  const nextBin = path.normalize(path.join(projectRoot, 'node_modules', '.bin', 'next'));

  nextDev = spawn(nextBin, ['dev', '-p', port.toString()], {
    stdio: 'inherit',
    env: { ...process.env, NEXT_PUBLIC_URL: miniAppUrl, NEXTAUTH_URL: miniAppUrl },
    cwd: projectRoot,
    shell: process.platform === 'win32' // Add shell option for Windows
  });

  // Handle cleanup
  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    console.log('\n\nShutting down...');

    try {
      if (nextDev) {
        try {
          // Kill the main process first
          nextDev.kill('SIGKILL');
          // Then kill any remaining child processes in the group
          if (nextDev?.pid) {
            try {
              process.kill(-nextDev.pid);
            } catch (e) {
              // Ignore ESRCH errors when killing process group
              if (e.code !== 'ESRCH') throw e;
            }
          }
          console.log('🛑 Next.js dev server stopped');
        } catch (e) {
          // Ignore errors when killing nextDev
          console.log('Note: Next.js process already terminated');
        }
      }

      // Force kill any remaining processes on the specified port
      await killProcessOnPort(port);
    } catch (error) {
      console.error('Error during cleanup:', error);
    } finally {
      process.exit(0);
    }
  };

  // Handle process termination
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);
}

startDev().catch(console.error); 