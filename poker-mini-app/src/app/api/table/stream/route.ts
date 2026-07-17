/**
 * Real-time Table SSE (Server-Sent Events) Route
 *
 * Provides a unidirectional server-to-client event stream for live table updates.
 * Usage: Connect via EventSource to /api/table/stream?table_id=<id>&fid=<fid>
 */

import { NextRequest } from "next/server";
import { ensureDb, buildTableResponse } from "../route";
import { db } from "~/lib/db";

interface TableSseClient {
  id: string;
  tableId: string;
  fid: number | null;
  controller: ReadableStreamDefaultController<Uint8Array>;
  lastPing: number;
}

const clients = new Map<string, TableSseClient>();

// Clean up stale clients every 30s
if (typeof globalThis !== "undefined") {
  const globalAny = globalThis as any;
  if (!globalAny.__tableSseCleanupInterval) {
    globalAny.__tableSseCleanupInterval = setInterval(() => {
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
  }
}

function encodeSse(event: string, data: unknown): Uint8Array {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const message = `event: ${event}\ndata: ${payload}\n\n`;
  return new TextEncoder().encode(message);
}

/**
 * Broadcast a table update to all connected SSE clients listening to this tableId.
 */
export async function broadcastTableUpdate(tableId: string): Promise<void> {
  if (clients.size === 0) return;

  for (const client of clients.values()) {
    if (client.tableId === tableId) {
      try {
        const response = await buildTableResponse(tableId, client.fid ?? undefined);
        if (response) {
          client.controller.enqueue(
            encodeSse("table", { ...response, timestamp: Date.now() })
          );
        }
      } catch (error) {
        console.error(`[sse-table] Failed to send update to client ${client.id}:`, error);
      }
    }
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
  const tableId = searchParams.get("table_id") || searchParams.get("tableId");

  if (!tableId) {
    return new Response(
      new TextDecoder().decode(encodeSse("error", { message: "Missing table_id parameter" })),
      {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      }
    );
  }

  const clientId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastStateHash = "";

      const checkDb = async () => {
        try {
          const { rows } = await db.execute({
            sql: "SELECT updated_at, status, pot_size, current_bet, current_turn_fid, phase, board FROM tables WHERE id = ?",
            args: [tableId],
          });
          const table = rows[0];
          if (!table) return;

          // Compute a simple hash representing the table state
          const stateHash = String(table.updated_at || "") + 
                            String(table.status || "") + 
                            String(table.pot_size || 0) + 
                            String(table.current_bet || 0) + 
                            String(table.current_turn_fid || "") +
                            String(table.phase || "") + 
                            String(table.board || "");

          if (stateHash !== lastStateHash) {
            lastStateHash = stateHash;
            const response = await buildTableResponse(tableId, fid ?? undefined);
            if (response) {
              controller.enqueue(
                encodeSse("table", { ...response, timestamp: Date.now() })
              );
            }
          }
        } catch {
          // Ignore database read errors in long-lived stream
        }
      };

      // Perform initial check
      void checkDb();

      // Register client
      clients.set(clientId, {
        id: clientId,
        tableId,
        fid,
        controller,
        lastPing: Date.now(),
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

      // Poll database for updates every 1s (provides cross-instance / Express server sync fallback)
      const dbInterval = setInterval(() => {
        void checkDb();
      }, 1000);

      // Clean up on close
      req.signal.addEventListener("abort", () => {
        clearInterval(pingInterval);
        clearInterval(dbInterval);
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
