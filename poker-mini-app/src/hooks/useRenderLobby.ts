"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPublicEnv } from "~/lib/env";
import type { UniversalUser } from "~/types/universal";

export type GameType = "NLHE" | "PLO" | "PLO8" | "STUD8";
export type TableStatus = "waiting" | "seated" | "full" | "in_game";

export type Seat = {
  seatNumber: number;
  user: UniversalUser | null;
  stack: number;
  isReady: boolean;
};

export type PokerTable = {
  id: string;
  name: string;
  game: GameType;
  stakes: string;
  maxPlayers: number;
  buyIn: number;
  status: TableStatus;
  createdAt: number;
  startTime?: string | null;
  seats: Seat[];
};

export type LobbyState = {
  tables: PokerTable[];
  updatedAt: number;
};

type ServerMessage =
  | { type: "state"; payload: LobbyState }
  | { type: "error"; payload: { message: string } };

type CurrentApiLobbyTable = {
  id: string;
  name: string;
  max_players: number;
  status: "waiting" | "playing" | "finished";
  start_time?: string | null;
};

type CurrentApiPlayer = {
  fid: number;
  username: string;
  pfp_url?: string;
  stack_size?: number;
  status?: "waiting" | "playing" | "folded" | "sitting_out";
  seat_index?: number;
};

const env = getPublicEnv();

const TABLE_PRESENTATION: Record<
  string,
  { game: GameType; stakes: string; buyIn: number }
> = {
  room_1: { game: "NLHE", stakes: "$0.10 / $0.25", buyIn: 25 },
  room_2: { game: "NLHE", stakes: "$1 / $2", buyIn: 50 },
  room_3: { game: "NLHE", stakes: "$2 / $5", buyIn: 100 },
};

function mapStatus(
  status: CurrentApiLobbyTable["status"],
  occupiedSeats: number,
  maxPlayers: number
): TableStatus {
  if (status === "playing") return "in_game";
  if (occupiedSeats >= maxPlayers) return "full";
  if (occupiedSeats > 0) return "seated";
  return "waiting";
}

function mapPlayerToUniversalUser(player: CurrentApiPlayer): UniversalUser {
  const isLikelyFarcaster = Number(player.fid) > 0;

  return {
    id: isLikelyFarcaster
      ? `fid:${player.fid}`
      : `guest:${player.fid}`,
    fid: Number(player.fid),
    username: player.username || `User#${player.fid}`,
    displayName: player.username || `User#${player.fid}`,
    avatarUrl: player.pfp_url || undefined,
    runtimeHost: "unknown_browser",
    authSource: isLikelyFarcaster ? "farcaster" : "guest",
  };
}

function mapCurrentApiTable(
  table: CurrentApiLobbyTable,
  players: CurrentApiPlayer[]
): PokerTable {
  const maxPlayers = Number(table.max_players || 6);
  const seatDefaults: Seat[] = Array.from({ length: maxPlayers }, (_, index) => ({
    seatNumber: index + 1,
    user: null,
    stack: 0,
    isReady: false,
  }));

  for (const [fallbackIndex, player] of players.entries()) {
    const seatIndex = Number.isFinite(Number(player.seat_index))
      ? Number(player.seat_index)
      : fallbackIndex;

    if (seatIndex < 0 || seatIndex >= seatDefaults.length) {
      continue;
    }

    seatDefaults[seatIndex] = {
      seatNumber: seatIndex + 1,
      user: mapPlayerToUniversalUser(player),
      stack: Number(player.stack_size || 0),
      isReady: player.status === "playing",
    };
  }

  const presentation =
    TABLE_PRESENTATION[table.id] ??
    ({ game: "NLHE", stakes: "$0.50 / $1", buyIn: 50 } as const);

  const occupiedSeats = players.length;

  return {
    id: table.id,
    name: table.name,
    game: presentation.game,
    stakes: presentation.stakes,
    buyIn: presentation.buyIn,
    maxPlayers,
    status: mapStatus(table.status, occupiedSeats, maxPlayers),
    createdAt: table.start_time ? new Date(table.start_time).getTime() : Date.now(),
    startTime: table.start_time ?? null,
    seats: seatDefaults,
  };
}

export function useRenderLobby() {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<LobbyState>({
    tables: [],
    updatedAt: Date.now(),
  });
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">(
    "connecting"
  );
  const [error, setError] = useState<string | null>(null);

  const wsUrl = useMemo(() => {
    if (!env.hasRenderLobby) return "";
    return `${env.renderWsUrl.replace(/\/$/, "")}/ws`;
  }, []);

  const refreshCurrentApiLobby = useCallback(async () => {
    try {
      const response = await fetch("/api/table", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Unable to load the poker lobby.");
      }

      const data = await response.json();
      const tables = (data.tables ?? []) as CurrentApiLobbyTable[];

      const detailedTables = await Promise.all(
        tables.map(async (table) => {
          try {
            const detailResponse = await fetch(
              `/api/table?table_id=${encodeURIComponent(table.id)}`,
              { cache: "no-store" }
            );

            if (!detailResponse.ok) {
              return mapCurrentApiTable(table, []);
            }

            const detailData = await detailResponse.json();
            return mapCurrentApiTable(
              detailData.gameState ?? table,
              (detailData.players ?? []) as CurrentApiPlayer[]
            );
          } catch {
            return mapCurrentApiTable(table, []);
          }
        })
      );

      setState({
        tables: detailedTables,
        updatedAt: Date.now(),
      });
      setStatus("connected");
      setError(null);
    } catch (caughtError) {
      setStatus("disconnected");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to reach the lobby."
      );
    }
  }, []);

  useEffect(() => {
    if (!env.hasRenderLobby || !wsUrl) {
      void refreshCurrentApiLobby();
      const interval = setInterval(() => {
        void refreshCurrentApiLobby();
      }, 4000);

      return () => clearInterval(interval);
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchFallback() {
      try {
        const response = await fetch(
          `${env.renderApiUrl.replace(/\/$/, "")}/lobby`,
          { cache: "no-store" }
        );

        if (!response.ok) return;

        const data = (await response.json()) as LobbyState;
        if (!cancelled) {
          setState(data);
        }
      } catch {
        // Keep the last known lobby state until the socket reconnects.
      }
    }

    function connect() {
      if (cancelled) return;

      setStatus("connecting");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setStatus("connected");
        setError(null);
        ws.send(JSON.stringify({ type: "get_state" }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;

          if (message.type === "state") {
            setState(message.payload);
            setError(null);
          } else if (message.type === "error") {
            setError(message.payload.message);
          }
        } catch {
          setError("Received an invalid lobby payload.");
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatus("disconnected");
        void fetchFallback();
        reconnectTimer = setTimeout(connect, 1500);
      };

      ws.onerror = () => {
        if (cancelled) return;
        setStatus("disconnected");
        setError("Lobby socket connection failed.");
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      wsRef.current?.close();
    };
  }, [refreshCurrentApiLobby, wsUrl]);

  const send = useCallback((message: unknown) => {
    const socket = wsRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Lobby is not connected yet.");
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const joinTable = useCallback(
    async (tableId: string, user: UniversalUser) => {
      if (env.hasRenderLobby) {
        send({ type: "join_table", payload: { tableId, user } });
        return;
      }

      try {
        const response = await fetch("/api/table", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid: user.fid,
            username: user.username,
            pfp_url: user.avatarUrl ?? "",
            table_id: tableId,
            action: "join",
          }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to join this table.");
        }

        await refreshCurrentApiLobby();
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to join this table."
        );
      }
    },
    [refreshCurrentApiLobby, send]
  );

  const leaveTable = useCallback(
    async (tableId: string, user: UniversalUser) => {
      if (env.hasRenderLobby) {
        send({ type: "leave_table", payload: { tableId, user } });
        return;
      }

      try {
        const response = await fetch("/api/table", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid: user.fid,
            table_id: tableId,
            action: "leave",
          }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to leave this table.");
        }

        await refreshCurrentApiLobby();
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to leave this table."
        );
      }
    },
    [refreshCurrentApiLobby, send]
  );

  const createTable = useCallback(
    (payload: {
      name: string;
      game: GameType;
      stakes: string;
      maxPlayers: number;
      buyIn: number;
    }) => {
      if (env.hasRenderLobby) {
        send({ type: "create_table", payload });
        return;
      }

      setError("Custom table creation is available once the Render lobby is configured.");
    },
    [send]
  );

  const toggleReady = useCallback(
    (tableId: string, user: UniversalUser) => {
      if (env.hasRenderLobby) {
        send({ type: "toggle_ready", payload: { tableId, user } });
        return;
      }

      setError("Ready-state controls are available once the Render lobby is configured.");
    },
    [send]
  );

  return {
    state,
    status,
    error,
    mode: env.hasRenderLobby ? "render" : "vercel_api",
    supportsTableCreation: env.hasRenderLobby,
    supportsReadyState: env.hasRenderLobby,
    createTable,
    joinTable,
    leaveTable,
    toggleReady,
  };
}
