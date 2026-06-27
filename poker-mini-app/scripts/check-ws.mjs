// ---------------------------------------------------------------------------
// WebSocket lobby health check
// Usage:
//   node scripts/check-ws.mjs wss://your-render-service.onrender.com
// Or set env var:
//   NEXT_PUBLIC_RENDER_WS_URL
// ---------------------------------------------------------------------------

import WebSocket from "ws";

const WS_TIMEOUT_MS = 25_000; // 25 s — covers Render cold-start wake-ups
const MAX_RETRIES   = 2;      // attempt up to 3 connections total

const rawWsUrl =
  process.env.NEXT_PUBLIC_RENDER_WS_URL ?? process.argv[2];

if (!rawWsUrl) {
  console.error("Missing WebSocket URL.");
  console.error(
    "Usage: node scripts/check-ws.mjs wss://your-render-service.onrender.com"
  );
  process.exit(1);
}

const url = `${rawWsUrl.replace(/\/$/, "")}/ws`;
console.log(`Connecting to ${url}`);

/** Attempt one WebSocket connection. Resolves true on a valid state payload,
 *  false on error/timeout/bad payload. */
function attempt(attemptNumber) {
  return new Promise((resolve) => {
    console.log(`\nAttempt ${attemptNumber + 1}/${MAX_RETRIES + 1}…`);

    const ws = new WebSocket(url);

    const timer = setTimeout(() => {
      console.error(`  Timed out after ${WS_TIMEOUT_MS / 1000}s.`);
      ws.close();
      resolve(false);
    }, WS_TIMEOUT_MS);

    ws.on("open", () => {
      console.log("  Socket open — sending get_state");
      ws.send(JSON.stringify({ type: "get_state" }));
    });

    ws.on("message", (raw) => {
      clearTimeout(timer);
      const text = raw.toString();

      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        console.error("  Received non-JSON payload:", text.slice(0, 200));
        ws.close();
        resolve(false);
        return;
      }

      // Server sends { type: "error" } when something is wrong.
      if (msg.type === "error") {
        console.error("  Server returned error payload:", JSON.stringify(msg.payload ?? msg));
        ws.close();
        resolve(false);
        return;
      }

      // Expect { type: "state", payload: { tables: [...] } }
      if (msg.type !== "state" || !msg.payload) {
        console.error("  Unexpected message type:", msg.type ?? "(none)");
        ws.close();
        resolve(false);
        return;
      }

      console.log("  Received state payload ✔");
      console.log(`  Tables: ${(msg.payload.tables ?? []).length}`);
      console.log(text.slice(0, 1000));
      ws.close();
      resolve(true);
    });

    ws.on("error", (error) => {
      clearTimeout(timer);
      console.error("  WebSocket error:", error.message);
      ws.close();
      resolve(false);
    });
  });
}

let success = false;
for (let i = 0; i <= MAX_RETRIES; i++) {
  success = await attempt(i);
  if (success) break;
  if (i < MAX_RETRIES) {
    const delay = 3000 * (i + 1);
    console.log(`  Retrying in ${delay / 1000}s…`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

if (!success) {
  console.error("\n✖ WebSocket check failed after all attempts.");
  process.exit(1);
}

console.log("\n✔ WebSocket check passed.");
process.exit(0);
