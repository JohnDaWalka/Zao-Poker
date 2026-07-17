"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "~/lib/env";

export type SseLobbyTable = {
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
  updated_at: string | null;
  visibility: string;
  club_id: string | null;
  club_name: string | null;
  phase: string;
  pot_size: number;
  current_bet: number;
  current_turn_fid: number | null;
};

export type SseTableDetail = SseLobbyTable & {
  board: string;
  action_history: string;
  players: Array<{
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
  }>;
};

export type SseLobbyState = {
  tables: SseLobbyTable[];
  timestamp: number;
};

type SseEvent =
  | { type: "lobby"; payload: SseLobbyState }
  | { type: "table"; payload: { table: SseTableDetail; timestamp: number } }
  | { type: "ping"; payload: { timestamp: number } }
  | { type: "error"; payload: { message: string } };

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

interface UseLobbySseOptions {
  fid?: number | null;
  tableId?: string | null;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect backoff in ms (default: 2000) */
  reconnectDelay?: number;
  /** Called when a new lobby state arrives */
  onLobbyUpdate?: (state: SseLobbyState) => void;
  /** Called when a single table update arrives */
  onTableUpdate?: (table: SseTableDetail) => void;
}

interface UseLobbySseReturn {
  state: SseLobbyState | null;
  tableDetail: SseTableDetail | null;
  status: ConnectionStatus;
  error: string | null;
  /** Manually reconnect the SSE stream */
  reconnect: () => void;
  /** Last event timestamp from server */
  lastEventAt: number | null;
}

/**
 * React hook for consuming the real-time lobby SSE stream.
 *
 * Connects to /api/lobby/sse and receives push updates for:
 * - Full lobby table list (event: "lobby")
 * - Single table detail (event: "table")
 * - Keepalive pings (event: "ping")
 *
 * Falls back gracefully to disconnected state on error and auto-reconnects.
 *
 * @example
 * const { state, status, error } = useLobbySse({ fid: user.fid });
 */
export function useLobbySse(options: UseLobbySseOptions = {}): UseLobbySseReturn {
  const {
    fid,
    tableId,
    autoReconnect = true,
    reconnectDelay = 2000,
    onLobbyUpdate,
    onTableUpdate,
  } = options;

  const [state, setState] = useState<SseLobbyState | null>(null);
  const [tableDetail, setTableDetail] = useState<SseTableDetail | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
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
    if (cancelledRef.current) return;

    cleanup();
    setStatus("connecting");
    setError(null);

    const params = new URLSearchParams();
    if (fid != null) params.set("fid", String(fid));
    if (tableId) params.set("tableId", tableId);

    const url = `${getApiUrl("/api/lobby/sse")}?${params.toString()}`;

    try {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        if (cancelledRef.current) return;
        setStatus("connected");
        setError(null);
        reconnectAttemptRef.current = 0;
      };

      es.addEventListener("lobby", (event: MessageEvent) => {
        if (cancelledRef.current) return;
        try {
          const data = JSON.parse(event.data) as SseLobbyState;
          setState(data);
          setLastEventAt(data.timestamp);
          onLobbyUpdate?.(data);
        } catch (err) {
          console.warn("[useLobbySse] Failed to parse lobby event:", err);
        }
      });

      es.addEventListener("table", (event: MessageEvent) => {
        if (cancelledRef.current) return;
        try {
          const data = JSON.parse(event.data) as { table: SseTableDetail; timestamp: number };
          setTableDetail(data.table);
          setLastEventAt(data.timestamp);
          onTableUpdate?.(data.table);
        } catch (err) {
          console.warn("[useLobbySse] Failed to parse table event:", err);
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
          setError("Lobby stream error");
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
  }, [fid, tableId, autoReconnect, reconnectDelay, onLobbyUpdate, onTableUpdate, cleanup]);

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
    state,
    tableDetail,
    status,
    error,
    reconnect,
    lastEventAt,
  };
}
