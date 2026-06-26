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
  currentBet: number;
  isReady: boolean;
  isBot: boolean;
  holeCards: string[];
};

export type PokerTable = {
  id: string;
  name: string;
  game: GameType;
  stakes: string;
  maxPlayers: number;
  buyIn: number;
  visibility: "public" | "club";
  clubId: string | null;
  clubName: string | null;
  status: TableStatus;
  createdAt: number;
  startTime?: string | null;
  board: string[];
  potSize: number;
  currentBet: number;
  phase: string;
  actionHistory: string[];
  currentTurnFid: number | null;
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
  game_type?: GameType;
  stakes_label?: string;
  max_players: number;
  buy_in?: number;
  visibility?: "public" | "club";
  club_id?: string | null;
  club_name?: string | null;
  status: "waiting" | "playing" | "finished";
  normalized_status?: TableStatus;
  created_at?: string | null;
  start_time?: string | null;
  board?: string;
  pot_size?: number;
  current_bet?: number;
  phase?: string;
  action_history?: string;
  current_turn_fid?: number | null;
};

type CurrentApiPlayer = {
  fid: number;
  username: string;
  pfp_url?: string;
  hand?: string;
  stack_size?: number;
  current_bet?: number;
  status?: "waiting" | "playing" | "folded" | "sitting_out";
  seat_index?: number;
  is_ready?: number;
  is_bot?: number;
};

const env = getPublicEnv();

function mapStatus(
  status: CurrentApiLobbyTable["status"],
  occupiedSeats: number,
  maxPlayers: number,
  normalizedStatus?: TableStatus
): TableStatus {
  if (normalizedStatus) return normalizedStatus;
  if (status === "playing") return "in_game";
  if (occupiedSeats >= maxPlayers) return "full";
  if (occupiedSeats > 0) return "seated";
  return "waiting";
}

function mapPlayerToUniversalUser(player: CurrentApiPlayer): UniversalUser {
  const isBot = Number(player.is_bot || 0) === 1;
  const isLikelyFarcaster = !isBot && Number(player.fid) > 0;

  return {
    id: isBot
      ? `bot:${player.fid}`
      : isLikelyFarcaster
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
    currentBet: 0,
    isReady: false,
    isBot: false,
    holeCards: [],
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
      currentBet: Number(player.current_bet || 0),
      isReady: Number(player.is_ready || 0) === 1,
      isBot: Number(player.is_bot || 0) === 1,
      holeCards: String(player.hand || "").split(",").filter(Boolean),
    };
  }

  const occupiedSeats = players.length;

  return {
    id: table.id,
    name: table.name,
    game: table.game_type ?? "NLHE",
    stakes: table.stakes_label ?? "$0.50 / $1",
    buyIn: Number(table.buy_in || 50),
    visibility: table.visibility === "club" ? "club" : "public",
    clubId: table.club_id ? String(table.club_id) : null,
    clubName: table.club_name ? String(table.club_name) : null,
    maxPlayers,
    status: mapStatus(table.status, occupiedSeats, maxPlayers, table.normalized_status),
    createdAt: table.created_at
      ? new Date(table.created_at).getTime()
      : table.start_time
        ? new Date(table.start_time).getTime()
        : Date.now(),
    startTime: table.start_time ?? null,
    board: String(table.board || "").split(",").filter(Boolean),
    potSize: Number(table.pot_size || 0),
    currentBet: Number(table.current_bet || 0),
    phase: String(table.phase || "preflop"),
    actionHistory: String(table.action_history || "").split("|").filter(Boolean),
    currentTurnFid: Number.isSafeInteger(Number(table.current_turn_fid))
      ? Number(table.current_turn_fid)
      : null,
    seats: seatDefaults,
  };
}

export function useRenderLobby(currentUser?: UniversalUser) {
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
  const currentFid =
    currentUser && Number.isSafeInteger(currentUser.fid) ? Number(currentUser.fid) : null;

  const refreshCurrentApiLobby = useCallback(async () => {
    try {
      const response = await fetch(
        currentFid !== null
          ? `/api/table?fid=${encodeURIComponent(String(currentFid))}`
          : "/api/table",
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Unable to load the poker lobby.");
      }

      const data = await response.json();
      const tables = (data.tables ?? []) as CurrentApiLobbyTable[];

      const detailedTables = await Promise.all(
        tables.map(async (table) => {
          try {
            const detailResponse = await fetch(
              `/api/table?table_id=${encodeURIComponent(table.id)}${
                currentFid !== null ? `&fid=${encodeURIComponent(String(currentFid))}` : ""
              }`,
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
  }, [currentFid]);

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
        return true;
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
        return true;
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to join this table."
        );
        return false;
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
    async (payload: {
      name: string;
      game: GameType;
      stakes: string;
      maxPlayers: number;
      buyIn: number;
      visibility?: "public" | "club";
      clubId?: string | null;
    }, user?: UniversalUser) => {
      if (env.hasRenderLobby) {
        send({ type: "create_table", payload });
        return;
      }

      try {
        const response = await fetch("/api/table", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid: user?.fid ?? -1,
            action: "create",
            ...payload,
            club_id: payload.clubId ?? undefined,
          }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to create this table.");
        }

        await refreshCurrentApiLobby();
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to create this table."
        );
      }
    },
    [refreshCurrentApiLobby, send]
  );

  const toggleReady = useCallback(
    async (tableId: string, user: UniversalUser) => {
      if (env.hasRenderLobby) {
        send({ type: "toggle_ready", payload: { tableId, user } });
        return true;
      }

      try {
        const response = await fetch("/api/table", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid: user.fid,
            table_id: tableId,
            action: "toggle_ready",
          }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to update ready state.");
        }

        await refreshCurrentApiLobby();
        return true;
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to update ready state."
        );
        return false;
      }
    },
    [refreshCurrentApiLobby, send]
  );

  const takeTableAction = useCallback(
    async (
      tableId: string,
      user: UniversalUser,
      action: "fold" | "check" | "call" | "bet" | "raise" | "all_in",
      amount = 0,
    ) => {
      if (env.hasRenderLobby) {
        setError("Live hand actions currently require the direct API mode.");
        return false;
      }

      try {
        const response = await fetch("/api/table", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid: user.fid,
            table_id: tableId,
            action,
            amount,
          }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to play this action.");
        }

        await refreshCurrentApiLobby();
        return true;
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to play this action.",
        );
        return false;
      }
    },
    [refreshCurrentApiLobby, send],
  );

  const dealTableHand = useCallback(
    async (tableId: string, user: UniversalUser) => {
      if (env.hasRenderLobby) {
        setError("Starting the next hand currently requires the direct API mode.");
        return false;
      }

      try {
        const response = await fetch("/api/table", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid: user.fid,
            table_id: tableId,
            action: "deal",
          }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to start the next hand.");
        }

        await refreshCurrentApiLobby();
        return true;
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to start the next hand.",
        );
        return false;
      }
    },
    [refreshCurrentApiLobby, send],
  );

  return {
    state,
    status,
    error,
    mode: env.hasRenderLobby ? "render" : "vercel_api",
    supportsTableCreation: true,
    supportsReadyState: true,
    createTable,
    joinTable,
    leaveTable,
    toggleReady,
    takeTableAction,
    dealTableHand,
    refresh: refreshCurrentApiLobby,
  };
}
