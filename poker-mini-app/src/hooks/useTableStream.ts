"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "~/lib/env";

export type StreamTablePlayer = {
  fid: number;
  username: string;
  pfp_url: string;
  stack_size: number;
  hand: string;
  visible_cards: string;
  current_bet: number;
  status: string;
  seat_index: number;
  is_ready: number;
  is_bot: number;
  neynar_score: number;
};

export type StreamTableDetail = {
  id: string;
  name: string;
  game_type: string;
  stakes_label: string;
  max_players: number;
  buy_in: number;
  status: string;
  player_count: number;
  is_viewer_seated: boolean;
  start_time: string | null;
  phase: string;
  pot_size: number;
  current_bet: number;
  current_turn_fid: number | null;
  board: string;
  action_history: string;
  players: StreamTablePlayer[];
};

export type TableStreamResponse = {
  success: boolean;
  gameState: StreamTableDetail;
  players: StreamTablePlayer[];
};

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

interface UseTableStreamOptions {
  tableId: string | null;
  fid: number | null;
  autoReconnect?: boolean;
  reconnectDelay?: number;
  onTableUpdate?: (data: TableStreamResponse) => void;
}

interface UseTableStreamReturn {
  tableDetail: TableStreamResponse | null;
  status: ConnectionStatus;
  error: string | null;
  reconnect: () => void;
  lastEventAt: number | null;
}

/**
 * React hook for consuming real-time table updates via SSE.
 * Connects to /api/table/stream?table_id=<tableId>&fid=<fid>
 */
export function useTableStream(options: UseTableStreamOptions): UseTableStreamReturn {
  const {
    tableId,
    fid,
    autoReconnect = true,
    reconnectDelay = 2000,
    onTableUpdate,
  } = options;

  const [tableDetail, setTableDetail] = useState<TableStreamResponse | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (cancelledRef.current || !tableId) {
      setStatus("disconnected");
      return;
    }

    cleanup();
    setStatus("connecting");
    setError(null);

    const params = new URLSearchParams();
    params.set("table_id", tableId);
    if (fid !== null) {
      params.set("fid", String(fid));
    }

    const url = `${getApiUrl("/api/table/stream")}?${params.toString()}`;

    try {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        if (cancelledRef.current) return;
        setStatus("connected");
        setError(null);
        reconnectAttemptRef.current = 0;
      };

      es.addEventListener("table", (event: MessageEvent) => {
        if (cancelledRef.current) return;
        try {
          const data = JSON.parse(event.data) as TableStreamResponse & { timestamp: number };
          setTableDetail(data);
          setLastEventAt(data.timestamp);
          onTableUpdate?.(data);
        } catch (err) {
          console.warn("[useTableStream] Failed to parse table event:", err);
        }
      });

      es.addEventListener("ping", (event: MessageEvent) => {
        if (cancelledRef.current) return;
        try {
          const data = JSON.parse(event.data) as { timestamp: number };
          setLastEventAt(data.timestamp);
        } catch {
          // Ignore malformed ping
        }
      });

      es.addEventListener("error", (event: MessageEvent) => {
        if (cancelledRef.current) return;
        try {
          const data = JSON.parse(event.data) as { message: string };
          setError(data.message);
        } catch {
          setError("Table stream error");
        }
        setStatus("error");
      });

      es.onerror = () => {
        if (cancelledRef.current) return;
        setStatus("disconnected");

        if (autoReconnect) {
          const delay = Math.min(
            reconnectDelay * Math.pow(1.5, reconnectAttemptRef.current),
            30000 // Max 30s backoff
          );
          reconnectAttemptRef.current += 1;
          reconnectTimerRef.current = setTimeout(() => {
            if (!cancelledRef.current) {
              connect();
            }
          }, delay);
        }
      };
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect");
    }
  }, [tableId, fid, autoReconnect, reconnectDelay, onTableUpdate, cleanup]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    cancelledRef.current = false;
    connect();

    return () => {
      cancelledRef.current = true;
      cleanup();
    };
  }, [connect, cleanup]);

  return {
    tableDetail,
    status,
    error,
    reconnect,
    lastEventAt,
  };
}
