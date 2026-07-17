"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPublicEnv, getApiUrl } from "~/lib/env";
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
  // Debug / action state (from server players)
  status?: string;
  hasActed?: boolean;
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
  serverUpdatedAt?: number;
  startTime?: string | null;
  board: string[];
  potSize: number;
  currentBet: number;
  phase: string;
  actionHistory: string[];
  currentTurnFid: number | null;
  dealerSeatIndex?: number;
  seats: Seat[];
  currentBlinds?: { sb: number; bb: number; ante: number };
  minVetScore?: number;
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
  updated_at?: string | null;
  start_time?: string | null;
  board?: string;
  pot_size?: number;
  current_bet?: number;
  phase?: string;
  action_history?: string;
  current_turn_fid?: number | null;
  dealer_seat_index?: number | null;
  min_vet_score?: number;
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
  neynar_score?: number;
};

type CurrentApiTableDetailResponse = {
  success?: boolean;
  gameState?: CurrentApiLobbyTable;
  players?: CurrentApiPlayer[];
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
    neynarScore: player.neynar_score,
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
      status: player.status,
      hasActed: Number((player as any).has_acted || 0) === 1,
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
    serverUpdatedAt: table.updated_at
      ? new Date(table.updated_at).getTime()
      : undefined,
    startTime: table.start_time ?? null,
    board: String(table.board || "").split(",").filter(Boolean),
    potSize: Number(table.pot_size || 0),
    currentBet: Number(table.current_bet || 0),
    phase: String(table.phase || "preflop"),
    actionHistory: String(table.action_history || "").split("|").filter(Boolean),
    currentTurnFid: Number.isSafeInteger(Number(table.current_turn_fid))
      ? Number(table.current_turn_fid)
      : null,
    dealerSeatIndex: Number.isSafeInteger(Number(table.dealer_seat_index))
      ? Number(table.dealer_seat_index)
      : 0,
    seats: seatDefaults,
    currentBlinds: (table as any).current_blinds ? {
      sb: Number((table as any).current_blinds.sb),
      bb: Number((table as any).current_blinds.bb),
      ante: Number((table as any).current_blinds.ante),
    } : undefined,
    minVetScore: Number(table.min_vet_score || 0),
  };
}

export function useRenderLobby(currentUser?: UniversalUser) {
  const wsRef = useRef<WebSocket | null>(null);
  const stateVersionRef = useRef(0);
  const appliedStateVersionRef = useRef(0);
  const cancelledRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<LobbyState>({
    tables: [],
    updatedAt: Date.now(),
  });
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">(
    "connecting"
  );
  const [error, setError] = useState<string | null>(null);

  const currentFid =
    currentUser && Number.isSafeInteger(currentUser.fid) ? Number(currentUser.fid) : null;

  const wsUrl = useMemo(() => {
    if (!env.hasRenderLobby || !env.renderWsUrl) return "";
    const params = new URLSearchParams();
    if (currentFid !== null) {
      params.set("fid", String(currentFid));
    }
    const query = params.toString();
    return `${env.renderWsUrl.replace(/\/$/, "")}/ws${query ? `?${query}` : ""}`;
  }, [currentFid]);

  const applySnapshot = useCallback((tables: PokerTable[], version: number) => {
    if (version < appliedStateVersionRef.current) {
      return false;
    }

    appliedStateVersionRef.current = version;

    setState((current) => {
      // Merge to protect detailed poker state (board, phase, holeCards, currentTurn, pot, seats)
      // from being overwritten by summary/lobby data that may arrive from WS or broad refreshes.
      // Prefer the richer table (more seated players, non-empty board/hands, or explicit currentTurn).
      // Additionally, always protect the current user's own holeCards if they would be lost.
      const merged = tables.map((incoming) => {
        const existing = current.tables.find((t) => t.id === incoming.id);
        if (!existing) return incoming;

        // CRITICAL: Time-based ordering. Never overwrite newer server data with older data.
        // This prevents race conditions where a stale GET response arrives after a fresh POST action.
        if (
          existing.serverUpdatedAt &&
          incoming.serverUpdatedAt &&
          incoming.serverUpdatedAt < existing.serverUpdatedAt
        ) {
          return existing;
        }

        const incomingSeated = incoming.seats.filter((s) => s.user).length;
        const existingSeated = existing.seats.filter((s) => s.user).length;
        const incomingHasBoard = incoming.board.length > 0;
        const existingHasBoard = existing.board.length > 0;
        const incomingHasTurn = !!incoming.currentTurnFid;
        const existingHasTurn = !!existing.currentTurnFid;
        const incomingHasHands = incoming.seats.some((s) => s.holeCards.length > 0);
        const existingHasHands = existing.seats.some((s) => s.holeCards.length > 0);

        let preferExisting =
          existingSeated > incomingSeated ||
          (!incomingHasTurn && existingHasTurn) ||
          (existingHasBoard && !incomingHasHands && existingHasHands);

        // Do NOT protect old board/hands across hand boundaries.
        // New hand = preflop with (re)fresh hole cards or phase transition from showdown.
        const isNewHandStart =
          incoming.phase === "preflop" &&
          (existing.phase === "showdown" || existing.phase !== "preflop" || (existing.board.length > 0 && incoming.board.length === 0));
        if (isNewHandStart) {
          preferExisting = false;
        } else if (!incomingHasBoard && existingHasBoard) {
          preferExisting = true;
        }

        // Extra protection: don't let the current user's hole cards disappear
        if (currentFid != null) {
          const existingSeat = existing.seats.find((s) => s.user?.fid === currentFid);
          const incomingSeat = incoming.seats.find((s) => s.user?.fid === currentFid);
          if (existingSeat && existingSeat.holeCards.length > 0) {
            if (!incomingSeat || incomingSeat.holeCards.length === 0) {
              preferExisting = true;
            }
          }
        }

        if (preferExisting) {
          // If we decide to keep existing but incoming has some updates (e.g. new board or bets),
          // we could merge more smartly, but for now just keep full existing to avoid losing cards.
          return existing;
        }
        return incoming;
      });

      // Defense-in-depth: strip hole cards for all players except the current user.
      // This prevents backend leaks from ever reaching the UI.
      const finalTables = merged.map((tbl) => {
        if (currentFid == null) return tbl;
        return {
          ...tbl,
          seats: tbl.seats.map((seat) => {
            if (seat.user?.fid === currentFid) return seat;
            return { ...seat, holeCards: [] };
          }),
        };
      });

      return {
        tables: finalTables,
        updatedAt: Date.now(),
      };
    });

    setStatus("connected");
    return true;
  }, [currentFid]);

  const mapTableDetail = useCallback((detail: CurrentApiTableDetailResponse) => {
    if (!detail.gameState) {
      return null;
    }

    return mapCurrentApiTable(detail.gameState, detail.players ?? []);
  }, []);

  const applyTableDetail = useCallback(
    (detail: CurrentApiTableDetailResponse) => {
      const mappedTable = mapTableDetail(detail);
      if (!mappedTable) {
        return false;
      }

      const version = ++stateVersionRef.current;
      appliedStateVersionRef.current = version;
      setState((current) => {
        const existingIndex = current.tables.findIndex((table) => table.id === mappedTable.id);

        if (existingIndex === -1) {
          return {
            tables: [mappedTable, ...current.tables],
            updatedAt: Date.now(),
          };
        }

        const existing = current.tables[existingIndex];

        // CRITICAL: Time-based ordering. Never overwrite newer server data with older data.
        if (
          existing.serverUpdatedAt &&
          mappedTable.serverUpdatedAt &&
          mappedTable.serverUpdatedAt < existing.serverUpdatedAt
        ) {
          return current;
        }

        const nextTables = [...current.tables];
        nextTables[existingIndex] = mappedTable;
        return {
          tables: nextTables,
          updatedAt: Date.now(),
        };
      });
      setStatus("connected");
      setError(null);
      return true;
    },
    [mapTableDetail],
  );

  const refreshCurrentApiLobby = useCallback(async () => {
    const version = ++stateVersionRef.current;

    try {
      const response = await fetch(
        getApiUrl(
          currentFid !== null
            ? `/api/table?fid=${encodeURIComponent(String(currentFid))}`
            : "/api/table",
        ),
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
              getApiUrl(
                `/api/table?table_id=${encodeURIComponent(table.id)}${
                  currentFid !== null ? `&fid=${encodeURIComponent(String(currentFid))}` : ""
                }`,
              ),
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

      applySnapshot(detailedTables, version);
    } catch (caughtError) {
      if (version < appliedStateVersionRef.current) {
        return;
      }

      setStatus("disconnected");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to reach the lobby."
      );
    }
  }, [applySnapshot, currentFid]);

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
        if (!env.renderApiUrl) return;
        const response = await fetch(
          `${env.renderApiUrl.replace(/\/$/, "")}/lobby`,
          { cache: "no-store" }
        );

        if (!response.ok) return;

        const data = (await response.json()) as LobbyState;
        if (!cancelled && Array.isArray(data.tables)) {
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
        if (currentFid !== null) {
          ws.send(JSON.stringify({ type: "init", payload: { fid: currentFid } }));
        }
        ws.send(JSON.stringify({ type: "get_state" }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;

          if (message.type === "state") {
            // Merge WS lobby state the same way as snapshots to protect detailed
            // poker table state (phase, board, seats/hole cards, pot, turn etc.)
            // from summary payloads that lack the full per-table game data.
            setState((current) => {
              const incomingTables: PokerTable[] = message.payload?.tables ?? [];
              const merged = incomingTables.map((incoming) => {
                const existing = current.tables.find((t) => t.id === incoming.id);
                if (!existing) return incoming;
                const incomingSeated = incoming.seats.filter((s) => s.user).length;
                const existingSeated = existing.seats.filter((s) => s.user).length;
                const incomingHasBoard = incoming.board.length > 0;
                const existingHasBoard = existing.board.length > 0;
                const preferExisting =
                  existingSeated > incomingSeated ||
                  (existing.board.length > 0 && incoming.seats.every(s => s.holeCards.length === 0));

                const isNewHandStart =
                  incoming.phase === "preflop" &&
                  (existing.phase === "showdown" || existing.phase !== "preflop" || (existing.board.length > 0 && incoming.board.length === 0));
                const finalPrefer = isNewHandStart ? false : ( (!incomingHasBoard && existingHasBoard) || preferExisting );
                return finalPrefer ? existing : incoming;
              });
              const strippedTables = currentFid != null
                ? merged.map((tbl) => ({
                    ...tbl,
                    seats: tbl.seats.map((seat) =>
                      seat.user?.fid === currentFid ? seat : { ...seat, holeCards: [] }
                    ),
                  }))
                : merged;
              return { tables: strippedTables, updatedAt: Date.now() };
            });
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
  }, [refreshCurrentApiLobby, wsUrl, currentFid]);

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
      // If Render lobby configured, use it for authoritative persistent state
      // (recommended for Farcaster production). Otherwise fall back to local
      // /api/table + Turso on Vercel.
      if (env.hasRenderLobby) {
        send({ type: "join_table", payload: { tableId, user } });
      }

      const actionUrl = env.hasRenderLobby
        ? `${env.renderApiUrl.replace(/\/$/, "")}/api/table`
        : getApiUrl("/api/table");
      try {
        const response = await fetch(actionUrl, {
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

        applyTableDetail(data as CurrentApiTableDetailResponse);
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
    [applyTableDetail, send]
  );

  const leaveTable = useCallback(
    async (tableId: string, user: UniversalUser) => {
      if (env.hasRenderLobby) {
        send({ type: "leave_table", payload: { tableId, user } });
      }

      const actionUrl = env.hasRenderLobby
        ? `${env.renderApiUrl.replace(/\/$/, "")}/api/table`
        : getApiUrl("/api/table");
      try {
        const response = await fetch(actionUrl, {
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

        applyTableDetail(data as CurrentApiTableDetailResponse);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to leave this table."
        );
      }
    },
    [applyTableDetail, send]
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
      // Always notify via WS if Render is configured, but HTTP is authoritative
      if (env.hasRenderLobby) {
        send({ type: "create_table", payload });
      }

      const actionUrl = env.hasRenderLobby
        ? `${env.renderApiUrl.replace(/\/$/, "")}/api/table`
        : getApiUrl("/api/table");

      try {
        const response = await fetch(actionUrl, {
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

        applyTableDetail(data as CurrentApiTableDetailResponse);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to create this table."
        );
      }
    },
    [applyTableDetail, send]
  );

  const toggleReady = useCallback(
    async (tableId: string, user: UniversalUser) => {
      if (env.hasRenderLobby) {
        send({ type: "toggle_ready", payload: { tableId, user } });
      }

      const actionUrl = env.hasRenderLobby
        ? `${env.renderApiUrl.replace(/\/$/, "")}/api/table`
        : getApiUrl("/api/table");
      try {
        const response = await fetch(actionUrl, {
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

        applyTableDetail(data as CurrentApiTableDetailResponse);
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
    [applyTableDetail, send]
  );

  const takeTableAction = useCallback(
    async (
      tableId: string,
      user: UniversalUser,
      action: "fold" | "check" | "call" | "bet" | "raise" | "all_in",
      amount = 0,
    ) => {
      // Drive game actions through Render (for persistence) when configured,
      // else local Vercel API. This ensures state (hands, board, actions) works
      // reliably on Farcaster mini-app.
      if (env.hasRenderLobby) {
        send({ type: "table_action", payload: { tableId, user, action, amount } });
      }

      const actionUrl = env.hasRenderLobby
        ? `${env.renderApiUrl.replace(/\/$/, "")}/api/table`
        : getApiUrl("/api/table");

      try {
        const response = await fetch(actionUrl, {
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

        applyTableDetail(data as CurrentApiTableDetailResponse);
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
    [applyTableDetail, send],
  );

  const dealTableHand = useCallback(
    async (tableId: string, user: UniversalUser) => {
      if (env.hasRenderLobby) {
        send({ type: "deal_hand", payload: { tableId, user } });
      }

      const actionUrl = env.hasRenderLobby
        ? `${env.renderApiUrl.replace(/\/$/, "")}/api/table`
        : getApiUrl("/api/table");
      try {
        const response = await fetch(actionUrl, {
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

        applyTableDetail(data as CurrentApiTableDetailResponse);
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
    [applyTableDetail, send],
  );

  const sendGameAction = useCallback(
    (
      tableId: string,
      user: UniversalUser,
      payload: { action: string; amount?: number },
    ) => {
      // Without a Render lobby there is no socket; calling send() would only
      // surface a spurious "Lobby is not connected yet." error. Game actions
      // reach the server via takeTableAction's POST regardless.
      if (!env.hasRenderLobby) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            "[lobby] sendGameAction skipped: no Render lobby configured (NEXT_PUBLIC_RENDER_API_URL / NEXT_PUBLIC_RENDER_WS_URL).",
          );
        }
        return;
      }
      send({ type: "game_action", payload: { tableId, user, ...payload } });
    },
    [send],
  );

  return {
    state,
    status,
    error,
    mode: env.hasRenderLobby ? "render" : "vercel_api",
    // Use Render.com for persistent real-time lobby state + Vercel for the
    // Farcaster mini-app frontend. Set the two NEXT_PUBLIC_RENDER_* vars in
    // Vercel to point at your Render service.
    supportsTableCreation: true,
    supportsReadyState: true,
    createTable,
    joinTable,
    leaveTable,
    toggleReady,
    takeTableAction,
    dealTableHand,
    refresh: refreshCurrentApiLobby,
    sendGameAction,
  };
}
