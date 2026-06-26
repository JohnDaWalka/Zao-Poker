import WebSocket from "ws";

const wsUrl =
  process.env.NEXT_PUBLIC_RENDER_WS_URL ?? process.argv[2];

if (!wsUrl) {
  console.error("Missing WebSocket URL.");
  console.error(
    "Usage: node scripts/check-ws.mjs wss://your-render-service.onrender.com"
  );
  process.exit(1);
}

const url = `${wsUrl.replace(/\/$/, "")}/ws`;

console.log(`Connecting to ${url}`);

const ws = new WebSocket(url);

const timeout = setTimeout(() => {
  console.error("Timed out waiting for WebSocket response.");
  ws.close();
  process.exit(1);
}, 8000);

ws.on("open", () => {
  console.log("WebSocket open.");
  ws.send(JSON.stringify({ type: "get_state" }));
});

ws.on("message", (raw) => {
  clearTimeout(timeout);
  console.log("Received:");
  console.log(raw.toString().slice(0, 2000));
  ws.close();
  process.exit(0);
});

ws.on("error", (error) => {
  clearTimeout(timeout);
  console.error("WebSocket error:", error.message);
  process.exit(1);
});
