/**
 * Real-time Lobby SSE (Server-Sent Events)
 *
 * Provides a unidirectional server-to-client event stream for live lobby updates.
 * This is ideal for serverless deployments (Vercel) where WebSockets are problematic
 * and long-polling adds unnecessary latency.
 *
 * Usage: Connect via EventSource to /api/lobby/sse
 * Events: "lobby" (full table list), "table" (single table update), "ping" (keepalive)
 */

import { NextRequest } from "next/server";
import { db, initDb } from "~/lib/db";

let dbReady: Promise<void> | null = null;

function ensureDb() {
  if (!dbReady) {
    dbReady = initDb().catch((error) => {
      dbReady = null;
      throw error;
    });
  }
  return dbReady;
}

// In-memory client registry for this serverless instance
// (clients reconnect on instance rotation; this is acceptable for lobby state)
interface SseClient {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  lastPing: number;
  fid: number | null;
}

const clients = new Map<string, SseClient>();

// Clean up stale clients every 30s
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 90000; // 90s (3 missed pings)
  for (const [id, client] of clients.entries()) {
    if (now - client.lastPing > staleThreshold) {
      try {
        client.controller.close();
      } catch {
        // Already closed
      }
      clients.delete(id);
    }
  }
}, 30000);

function encodeSse(event: string, data: unknown): Uint8Array {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const message = `event: ${event}\ndata: ${payload}\n\n`;
  return new TextEncoder().encode(message);
}

async function fetchLobbyTables(fid: number | null): Promise<unknown[]> {
  const { rows: tables } = await db.execute(
    "SELECT * FROM tables ORDER BY COALESCE(created_at, updated_at, start_time), id"
  );
  const { rows: players } = await db.execute(
    "SELECT table_id, fid, is_ready, is_bot FROM players ORDER BY table_id, seat_index ASC"
  );

  const playersByTable = players.reduce<Record<string, typeof players>>(
    (acc, player) => {
      const tid = String(player.table_id);
      if (!acc[tid]) acc[tid] = [];
      acc[tid].push(player);
      return acc;
    },
    {}
  );

  // Build viewer club membership set
  const viewerClubIds =
    fid !== null
      ? new Set(
          (
            await db.execute({
              sql: "SELECT club_id FROM club_memberships WHERE fid = ?",
              args: [fid],
            })
          ).rows.map((row) => String(row.club_id))
        )
      : new Set<string>();

  const visibleTables = tables.filter((table: any) => {
    const visibility = String(table.visibility || "public");
    if (visibility !== "club") return true;
    return viewerClubIds.has(String(table.club_id || ""));
  });

  return visibleTables.map((table: any) => {
    const tablePlayers = playersByTable[String(table.id)] ?? [];
    const playerCount = tablePlayers.length;
    const isPlaying = table.status === "playing";

    return {
      id: table.id,
      name: table.name || "Poker Table",
      game_type: table.game_type || "NLHE",
      stakes_label: table.stakes_label || "$0.50 / $1",
      max_players: Number(table.max_players || 6),
      buy_in: Number(table.buy_in || 50),
      status: isPlaying ? "playing" : table.status || "waiting",
      player_count: playerCount,
      is_viewer_seated:
        fid !== null && tablePlayers.some((p: any) => Number(p.fid) === fid),
      start_time: table.start_time ?? null,
      updated_at: table.updated_at ?? null,
      visibility: table.visibility || "public",
      club_id: table.club_id ?? null,
      club_name: table.club_name ?? null,
      phase: table.phase || "preflop",
      pot_size: Number(table.pot_size || 0),
      current_bet: Number(table.current_bet || 0),
      current_turn_fid: table.current_turn_fid ?? null,
    };
  });
}

async function fetchSingleTable(tableId: string, fid: number | null): Promise<unknown | null> {
  const { rows: tables } = await db.execute({
    sql: "SELECT * FROM tables WHERE id = ?",
    args: [tableId],
  });
  if (tables.length === 0) return null;
  const table = tables[0] as any;

  const { rows: players } = await db.execute({
    sql: `SELECT fid, username, pfp_url, stack_size, hand, visible_cards, current_bet, status, seat_index, is_ready, is_bot, neynar_score 
          FROM players WHERE table_id = ? ORDER BY seat_index ASC`,
    args: [tableId],
  });

  // Mask hole cards for non-current user
  const maskedPlayers = players.map((player: any) => {
    if (fid !== null && Number(player.fid) === fid) return player;
    return { ...player, hand: "" };
  });

  return {
    id: table.id,
    name: table.name || "Poker Table",
    game_type: table.game_type || "NLHE",
    stakes_label: table.stakes_label || "$0.50 / $1",
    max_players: Number(table.max_players || 6),
    buy_in: Number(table.buy_in || 50),
    status: table.status || "waiting",
    player_count: players.length,
    is_viewer_seated:
      fid !== null && players.some((p: any) => Number(p.fid) === fid),
    start_time: table.start_time ?? null,
    phase: table.phase || "preflop",
    pot_size: Number(table.pot_size || 0),
    current_bet: Number(table.current_bet || 0),
    current_turn_fid: table.current_turn_fid ?? null,
    board: table.board || "",
    action_history: table.action_history || "",
    players: maskedPlayers,
  };
}

/**
 * Broadcast a lobby update to all connected SSE clients.
 * Call this from table mutation endpoints (POST /api/table) to push real-time updates.
 */
export async function broadcastLobbyUpdate(): Promise<void> {
  if (clients.size === 0) return;

  try {
    const tables = await fetchLobbyTables(null);
    const payload = encodeSse("lobby", { tables, timestamp: Date.now() });

    for (const client of clients.values()) {
      try {
        client.controller.enqueue(payload);
      } catch {
        // Client disconnected
      }
    }
  } catch (error) {
    console.error("[sse] broadcastLobbyUpdate failed:", error);
  }
}

/**
 * Broadcast a single table update to all connected SSE clients.
 */
export async function broadcastTableUpdate(tableId: string): Promise<void> {
  if (clients.size === 0) return;

  try {
    const table = await fetchSingleTable(tableId, null);
    if (!table) return;

    const payload = encodeSse("table", { table, timestamp: Date.now() });

    for (const client of clients.values()) {
      try {
        client.controller.enqueue(payload);
      } catch {
        // Client disconnected
      }
    }
  } catch (error) {
    console.error("[sse] broadcastTableUpdate failed:", error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureDb();
  } catch {
    return new Response(
      new TextDecoder().decode(encodeSse("error", { message: "Database unavailable" })),
      {
        status: 503,
        headers: { "Content-Type": "text/event-stream" },
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const fidParam = searchParams.get("fid");
  const fid = fidParam ? Number(fidParam) : null;
  const tableId = searchParams.get("tableId");
  const clientId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Send initial data immediately
      const sendInitial = async () => {
        try {
          if (tableId) {
            const table = await fetchSingleTable(tableId, fid);
            if (table) {
              controller.enqueue(encodeSse("table", { table, timestamp: Date.now() }));
            }
          } else {
            const tables = await fetchLobbyTables(fid);
            controller.enqueue(encodeSse("lobby", { tables, timestamp: Date.now() }));
          }
        } catch (error) {
          controller.enqueue(encodeSse("error", { message: "Failed to load lobby" }));
        }
      };

      void sendInitial();

      // Register client
      clients.set(clientId, {
        id: clientId,
        controller,
        lastPing: Date.now(),
        fid,
      });

      // Send ping every 15s to keep connection alive
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encodeSse("ping", { timestamp: Date.now() }));
          const client = clients.get(clientId);
          if (client) client.lastPing = Date.now();
        } catch {
          clearInterval(pingInterval);
          clients.delete(clientId);
        }
      }, 15000);

      // Clean up on close
      req.signal.addEventListener("abort", () => {
        clearInterval(pingInterval);
        clients.delete(clientId);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
