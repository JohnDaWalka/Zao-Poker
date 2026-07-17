"use client";

import { useState, useEffect, useCallback } from "react";
import { getApiUrl } from "~/lib/env";
import { UniversalConnectBar } from "~/components/ui/UniversalConnectBar";
import { useRenderLobby } from "~/hooks/useRenderLobby";
import { useTableStream } from "~/hooks/useTableStream";
import { useUniversalUser } from "~/hooks/useUniversalUser";

// Helper to convert card string (e.g. "Ah") to display components
function getCardDisplay(card: string) {
  if (!card || card.length < 2) return { rank: "", suitSymbol: "", isRed: false };
  const rank = card[0] === "T" ? "10" : card[0];
  const suit = card[1];
  let suitSymbol = "";
  let isRed = false;
  if (suit === "h") { suitSymbol = "♥"; isRed = true; }
  else if (suit === "d") { suitSymbol = "♦"; isRed = true; }
  else if (suit === "c") { suitSymbol = "♣"; isRed = false; }
  else if (suit === "s") { suitSymbol = "♠"; isRed = false; }
  return { rank, suitSymbol, isRed };
}

interface TableData {
  id: string;
  name: string;
  max_players: number;
  status: "waiting" | "playing" | "finished";
  player_count: number;
  start_time: string;
  game_type?: string;
  stakes_label?: string;
  is_viewer_seated?: boolean;
}

function isTournamentTable(table: TableData) {
  const name = (table.name || "").toLowerCase();
  return (
    name.includes("tourney") ||
    name.includes("tournament") ||
    name.includes("sit & go") ||
    name.includes("sng") ||
    name.includes("turbo")
  );
}

export function HomeTab() {
  // Falls back Farcaster user -> connected wallet -> guest, so browsers/
  // wallets outside Farcaster get a stable per-user identity instead of all
  // colliding on a single shared placeholder fid.
  const universalUser = useUniversalUser();
  const renderLobby = useRenderLobby();

  // Navigation states
  const [gameState, setGameState] = useState<"lobby" | "table">("lobby");
  const [selectedTableId, setSelectedTableId] = useState<string>("");

  // Lobby states
  const [lobbyTables, setLobbyTables] = useState<TableData[]>([]);
  const [joinError, setJoinError] = useState<string>("");
  const [joiningTableId, setJoiningTableId] = useState<string | null>(null);
  const [lobbyTypeTab, setLobbyTypeTab] = useState<"cash" | "tournament">("cash");

  // Active table states
  const [tableStatus, setTableStatus] = useState<string>("waiting");
  const [tableName, setTableName] = useState<string>("");
  const [maxPlayers, setMaxPlayers] = useState<number>(6);
  const [startTime, setStartTime] = useState<string>("");
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [potSize, setPotSize] = useState(0);
  const [playerStack, setPlayerStack] = useState(5000);
  const [coachFeedback, setCoachFeedback] = useState<any>(null);
  const [lastHandResult, setLastHandResult] = useState<"win" | "loss" | "split" | null>(null);

  // Game loop states
  const [board, setBoard] = useState<string[]>([]);
  const [playerCards, setPlayerCards] = useState<string[]>([]);
  const [phase, setPhase] = useState<string>("preflop");
  const [currentBet, setCurrentBet] = useState(0);
  const [playerCurrentBet, setPlayerCurrentBet] = useState(0);
  const [seatedPlayers, setSeatedPlayers] = useState<any[]>([]);
  const [currentTurnFid, setCurrentTurnFid] = useState<number | null>(null);
  const [tableActionHistory, setTableActionHistory] = useState<string[]>([]);
  const [isTrainingMode, setIsTrainingMode] = useState(false);

  // Blind states
  const [currentBlinds, setCurrentBlinds] = useState<{ sb: number, bb: number, ante: number } | null>(null);
  const [nextLevelInSecs, setNextLevelInSecs] = useState<number>(0);

  // 1. Poll Lobby list
  useEffect(() => {
    if (gameState !== "lobby") return;
    const fetchLobby = async () => {
      try {
        const url = getApiUrl(universalUser.fid ? `/api/table?fid=${universalUser.fid}` : "/api/table");
        const res = await fetch(url);
        const data = await res.json();
        if (res.ok && data.success) {
          setLobbyTables(data.tables);
          setJoinError("");
        } else {
          setJoinError(data.error || "Unable to load poker tables");
        }
      } catch (e) {
        setJoinError("Unable to connect to the poker server");
      }
    };
    fetchLobby();
    const interval = setInterval(fetchLobby, 4000);
    return () => clearInterval(interval);
  }, [gameState, universalUser.fid]);

  // 2. Poll Active Table / Waiting Room state is now handled by real-time streams below.

  const sendEvent = async (eventData: any) => {
    try {
      await fetch(
        "https://api.neynar.com/f/app/ded91835-5060-4c07-ae3c-f45ca0935ec2/event",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid: universalUser.fid,
            ...eventData,
          }),
        }
      );
    } catch (e) { }
  };

  /** Apply a full game-state response from any API call (join, deal, action). */
  const applyGameStateResponse = (data: any, myFid: number) => {
    if (!data.success || !data.gameState) return;
    setTableName(data.gameState.name || "");
    setTableStatus(data.gameState.status || "waiting");
    setStartTime(data.gameState.start_time || "");
    setPotSize(data.gameState.pot_size || 0);
    setPhase(data.gameState.phase || "preflop");
    setCurrentBet(data.gameState.current_bet || 0);
    setBoard(data.gameState.board ? data.gameState.board.split(",").filter(Boolean) : []);
    setTableActionHistory(
      data.gameState.action_history
        ? String(data.gameState.action_history).split("|").filter(Boolean)
        : []
    );
    setSeatedPlayers(data.players || []);
    setCurrentTurnFid(data.gameState.current_turn_fid ?? null);
    if (data.gameState.current_blinds) setCurrentBlinds(data.gameState.current_blinds);
    if (data.gameState.next_level_in_secs !== undefined) setNextLevelInSecs(data.gameState.next_level_in_secs);
    const maxPlayers = data.gameState.max_players;
    if (maxPlayers) setMaxPlayers(Number(maxPlayers));

    const me = (data.players || []).find((p: any) => Number(p.fid) === myFid);
    if (me) {
      setPlayerStack(Number(me.stack_size) || 0);
      setPlayerCurrentBet(Number(me.current_bet) || 0);
      setPlayerCards(me.hand ? String(me.hand).split(",").filter(Boolean) : []);
    }
  };

  const applyLobbyTableToUi = useCallback((table: any, myFid: number) => {
    if (!table) return;
    setTableName(table.name || "");
    setTableStatus(table.status === "in_game" ? "playing" : (table.status || "waiting"));
    setStartTime(table.startTime || "");
    setPotSize(table.potSize || 0);
    setPhase(table.phase || "preflop");
    setCurrentBet(table.currentBet || 0);
    setBoard(table.board || []);
    setTableActionHistory(table.actionHistory || []);
    
    const mappedPlayers = (table.seats || []).filter((s: any) => s.user).map((s: any) => {
      const u = s.user;
      return {
        fid: u.fid,
        username: u.username,
        pfp_url: u.avatarUrl || "",
        stack_size: s.stack,
        current_bet: s.currentBet,
        hand: (s.holeCards || []).join(","),
        seat_index: s.seatNumber - 1,
        is_ready: s.isReady ? 1 : 0,
        is_bot: s.isBot ? 1 : 0,
        neynar_score: u.neynarScore,
      };
    });
    
    setSeatedPlayers(mappedPlayers);
    setCurrentTurnFid(table.currentTurnFid ?? null);
    if (table.currentBlinds) setCurrentBlinds(table.currentBlinds);
    
    const maxPlayers = table.maxPlayers;
    if (maxPlayers) setMaxPlayers(Number(maxPlayers));

    const me = mappedPlayers.find((p: any) => Number(p.fid) === myFid);
    if (me) {
      setPlayerStack(Number(me.stack_size) || 0);
      setPlayerCurrentBet(Number(me.current_bet) || 0);
      setPlayerCards(me.hand ? String(me.hand).split(",").filter(Boolean) : []);
    }
  }, []);

  // Real-time updates for Active Table state
  const myFid = Number(universalUser.fid);

  // Sync with WebSocket lobby updates (if using Render Express server)
  useEffect(() => {
    if (gameState !== "table" || !selectedTableId || renderLobby.mode !== "render") return;
    const table = renderLobby.state.tables.find((t) => t.id === selectedTableId);
    if (table) {
      applyLobbyTableToUi(table, myFid);
    }
  }, [gameState, selectedTableId, renderLobby.state.tables, renderLobby.mode, myFid, applyLobbyTableToUi]);

  // Sync via SSE stream (if in Vercel serverless / local mode)
  const handleTableStreamUpdate = useCallback((data: any) => {
    if (data.success && data.gameState) {
      applyGameStateResponse(data, myFid);
    }
  }, [myFid]);

  useTableStream({
    tableId: (gameState === "table" && selectedTableId && renderLobby.mode !== "render") ? selectedTableId : null,
    fid: myFid,
    onTableUpdate: handleTableStreamUpdate,
  });

  const handleJoinTable = async (tableId: string) => {
    if (joiningTableId) return;

    setJoiningTableId(tableId);
    setJoinError("");

    const payload = {
      fid: universalUser.fid,
      username: universalUser.username,
      pfp_url: universalUser.avatarUrl || "",
      table_id: tableId,
      action: "join"
    };

    try {
      const res = await fetch(getApiUrl("/api/table"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok || !data.success || !data.gameState) {
        throw new Error(data.error || "Unable to join this table");
      }

      setSelectedTableId(tableId);
      setGameState("table");
      applyGameStateResponse(data, Number(universalUser.fid));
      void sendEvent({ action: "user_joined_table", table_id: tableId });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Unable to join this table");
    } finally {
      setJoiningTableId(null);
    }
  };

  const handleLeaveTable = async () => {
    void sendEvent({ action: "user_left_table", table_id: selectedTableId });
    await fetch(getApiUrl("/api/table"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fid: universalUser.fid,
        table_id: selectedTableId,
        action: "leave"
      })
    });
    setGameState("lobby");
    setSelectedTableId("");
    setCoachFeedback(null);
    setTableActionHistory([]);
  };

  const handleStartPractice = async () => {
    await fetch(getApiUrl("/api/table"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fid: universalUser.fid,
        table_id: selectedTableId,
        action: "deal"
      })
    });
  };

  const handleNextHand = async () => {
    setCoachFeedback(null);
    setLastHandResult(null);
    const res = await fetch(getApiUrl("/api/table"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fid: universalUser.fid,
        table_id: selectedTableId,
        action: "deal"
      })
    });
    const data = await res.json();
    if (data.success && data.gameState) {
      applyGameStateResponse(data, Number(universalUser.fid));
    }
  };

  const handleAction = async (action: string, customAmount?: number) => {
    sendEvent({ action });

    let amount = 0;
    const toCall = currentBet - playerCurrentBet;

    if (action === "call") {
      amount = toCall;
    } else if (action === "bet" || action === "raise") {
      amount = customAmount || 0;
    } else if (action === "all_in") {
      amount = playerStack;
    }

    const nextActionHistory = [
      ...tableActionHistory,
      `p${universalUser.fid}:${action}${amount > 0 ? `:${Math.round(amount)}` : ""}`,
    ];

    const res = await fetch(getApiUrl("/api/table"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fid: universalUser.fid,
        table_id: selectedTableId,
        action,
        amount
      })
    });

    const data = await res.json();
    if (data.success && data.gameState) {
      const prevPhase = phase;
      applyGameStateResponse(data, Number(universalUser.fid));

      // Determine hand result when transitioning to showdown
      if (data.gameState.phase === "showdown" && prevPhase !== "showdown") {
        const myFid = Number(universalUser.fid);
        const me = (data.players || []).find((p: any) => Number(p.fid) === myFid);
        // Pot was just zeroed by resolveShowdown/resolveFoldWin, so compare stacks
        // to the opponent's to infer win/loss from the action history last entry.
        const lastEntry = data.gameState.action_history
          ? String(data.gameState.action_history).split("|").filter(Boolean).at(-1) ?? ""
          : "";
        if (lastEntry.includes("fold")) {
          // Opponent folded — we won (unless WE just folded)
          const iWasFolding = action === "fold";
          setLastHandResult(iWasFolding ? "loss" : "win");
        } else if (me) {
          // Showdown: a positive stack change means we won
          const stackBefore = playerStack;
          const stackAfter = Number(me.stack_size);
          if (stackAfter > stackBefore) setLastHandResult("win");
          else if (stackAfter < stackBefore) setLastHandResult("loss");
          else setLastHandResult("split");
        }
      }
    }

    try {
      const resAnalyze = await fetch(getApiUrl("/api/analyze"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid: universalUser.fid,
          action,
          amount: amount,
          pot_size: potSize + amount,
          stack_size: playerStack - amount,
          cards: playerCards,
          board,
          to_call: toCall,
          opponent_count: Math.max(1, seatedPlayers.length - 1),
          action_history: nextActionHistory,
        })
      });
      const resData = await resAnalyze.json();
      setCoachFeedback(resData);
    } catch (e) { }
  };

  const toCall = currentBet - playerCurrentBet;
  const showRenderLobbyStatus =
    renderLobby.mode === "render" && renderLobby.status !== "connected";
  const renderLobbyStatusLabel =
    renderLobby.status === "connecting"
      ? "Connecting to Render lobby..."
      : "Reconnecting Render lobby...";

  const runtimeChrome = (
    <>
      <UniversalConnectBar />
      {showRenderLobbyStatus && (
        <div className="glass-panel border-yellow-500/25 bg-yellow-950/20 px-4 py-3 text-sm text-yellow-200">
          {renderLobbyStatusLabel}
        </div>
      )}
      {renderLobby.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-200"
        >
          {renderLobby.error}
        </div>
      )}
    </>
  );

  const filteredTables = lobbyTables.filter((table) => {
    const isTourney = isTournamentTable(table);
    return lobbyTypeTab === "cash" ? !isTourney : isTourney;
  });

  // LOBBY VIEW
  if (gameState === "lobby") {
    return (
      <div className="flex flex-col min-h-screen bg-surface text-white p-4">
        <header className="py-6 text-center border-b border-primary/15 mb-6">
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary-light to-neon-green drop-shadow-[0_0_12px_rgba(34,211,238,0.35)]">
            ZAO Poker Lobby
          </h1>
          <p className="text-xs text-gray-500 mt-1">Select a table to join — Farcaster, wallet, or guest</p>
        </header>

        <div className="flex-1 flex flex-col space-y-4 max-w-md mx-auto w-full">
          {runtimeChrome}
          {joinError && (
            <div role="alert" className="rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-200">
              {joinError}
            </div>
          )}

          {/* Tournament / Cash Game Tab Selection */}
          <div className="flex bg-surface-dark border border-primary/10 p-1 rounded-xl w-full shadow-inner">
            <button
              onClick={() => setLobbyTypeTab("cash")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${
                lobbyTypeTab === "cash"
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <span>💵</span> Cash Games
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                lobbyTypeTab === "cash" ? "bg-white/20 text-white" : "bg-primary/10 text-primary-light"
              }`}>
                {lobbyTables.filter(t => !isTournamentTable(t)).length}
              </span>
            </button>
            <button
              onClick={() => setLobbyTypeTab("tournament")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${
                lobbyTypeTab === "tournament"
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <span>🏆</span> Tournaments
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                lobbyTypeTab === "tournament" ? "bg-white/20 text-white" : "bg-primary/10 text-primary-light"
              }`}>
                {lobbyTables.filter(t => isTournamentTable(t)).length}
              </span>
            </button>
          </div>

          {filteredTables.length === 0 ? (
            <div className="text-center text-gray-500 py-10">
              {lobbyTables.length === 0
                ? "Loading active games..."
                : `No active ${lobbyTypeTab === "cash" ? "cash games" : "tournaments"} available.`}
            </div>
          ) : (
            filteredTables.map((table) => (
              <div
                key={table.id}
                className="glass-panel hover:border-primary/40 p-4 flex flex-col justify-between transition-all"
              >
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-bold text-lg text-gray-200">{table.name}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase ${table.status === "playing"
                        ? "bg-yellow-900 text-yellow-200"
                        : "bg-green-900 text-green-200"
                      }`}
                  >
                    {table.status}
                  </span>
                </div>

                {/* Variant & Stakes badge row */}
                <div className="flex gap-2 mb-3">
                  <span className="text-xs bg-primary/10 text-primary-light px-2 py-0.5 rounded border border-primary/20 font-semibold">
                    {table.game_type ?? "NLHE"}
                  </span>
                  <span className="text-xs bg-neon-gold/10 text-neon-gold px-2 py-0.5 rounded border border-neon-gold/20 font-mono">
                    Stakes: {table.stakes_label ?? "$0.50 / $1"}
                  </span>
                </div>

                <div className="flex justify-between items-center mt-2">
                  <div className="text-sm text-gray-400">
                    Seated: <span className="text-white font-bold">{table.player_count}/{table.max_players}</span>
                    {table.start_time && (
                      <div className="text-yellow-500 font-mono text-xs mt-1">
                        Starts in {(() => {
                          const start = new Date(table.start_time);
                          const diffMs = start.getTime() - currentTime.getTime();
                          if (diffMs <= 0) return "00:00";
                          const diffSecs = Math.floor(diffMs / 1000);
                          const mins = Math.floor(diffSecs / 60);
                          const secs = diffSecs % 60;
                          return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                        })()}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleJoinTable(table.id)}
                    disabled={
                      joiningTableId !== null ||
                      (!table.is_viewer_seated && (
                        table.player_count >= table.max_players ||
                        (table.status === "playing" && table.player_count >= 2)
                      ))
                    }
                    className={`text-sm font-bold py-2 px-5 rounded-lg shadow transition-transform transform ${joiningTableId === null &&
                        (table.is_viewer_seated || (
                          table.player_count < table.max_players &&
                          (table.status !== "playing" || table.player_count < 2)
                        ))
                        ? "bg-green-600 hover:bg-green-700 text-white active:scale-95"
                        : "bg-gray-700 text-gray-500 cursor-not-allowed"
                      }`}
                  >
                    {joiningTableId === table.id
                      ? "Joining..."
                      : table.is_viewer_seated
                        ? "Rejoin"
                        : table.player_count >= table.max_players
                          ? "Full"
                          : table.status === "playing" && table.player_count >= 2
                            ? "In Progress"
                            : "Join Room"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // WAITING ROOM VIEW
  if (gameState === "table" && tableStatus === "waiting") {
    return (
      <div className="flex flex-col min-h-screen bg-surface text-white p-4 justify-between">
        <header className="py-4 text-center border-b border-primary/15">
          <h2 className="text-xl font-bold text-primary-light">Waiting Room</h2>
          <p className="text-sm text-neon-gold font-semibold">{tableName}</p>
        </header>

        <div className="my-auto max-w-md mx-auto w-full space-y-4">
          {runtimeChrome}
          <div className="glass-panel w-full p-4">
            <h3 className="text-sm font-semibold tracking-wider text-gray-500 uppercase mb-4 text-center">
              Seated Players ({seatedPlayers.length}/{maxPlayers})
            </h3>

            {startTime && (
              <div className="text-center mb-6">
                <div className="text-xs text-gray-400 uppercase tracking-widest mb-1">Tournament starts in</div>
                <div className="text-4xl font-mono text-yellow-500 font-bold bg-gray-950 py-3 rounded-lg border border-gray-800 shadow-inner">
                  {(() => {
                    const start = new Date(startTime);
                    const diffMs = start.getTime() - currentTime.getTime();
                    if (diffMs <= 0) return "00:00";
                    const diffSecs = Math.floor(diffMs / 1000);
                    const mins = Math.floor(diffSecs / 60);
                    const secs = diffSecs % 60;
                    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                  })()}
                </div>
              </div>
            )}

            <div className="flex flex-col space-y-3 mb-6">
              {seatedPlayers.map((player) => (
                <div key={player.fid} className="flex items-center space-x-3 bg-gray-950 p-2.5 rounded-lg border border-gray-900">
                  {player.pfp_url ? (
                    <img src={player.pfp_url} alt="Pfp" className="w-9 h-9 rounded-full" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center font-bold text-xs">
                      {player.username[0]}
                    </div>
                  )}
                  <div>
                    <div className="font-bold text-sm text-gray-200">@{player.username}</div>
                    <div className="text-xs text-gray-500">FID: {player.fid}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col space-y-2">
              <button
                disabled
                className="bg-gray-800 text-gray-500 font-bold py-3 rounded-lg text-center text-sm shadow cursor-not-allowed"
              >
                Waiting for Tournament to Start... ⏱️
              </button>
              <button
                onClick={handleLeaveTable}
                className="bg-red-900 bg-opacity-20 hover:bg-red-900 hover:bg-opacity-40 text-red-400 font-semibold py-2 rounded-lg text-center text-sm transition-colors"
              >
                Leave Room
              </button>
            </div>
          </div>
        </div>

        <footer className="text-center text-xs text-gray-600 py-2">
          Waiting for other players to launch their Farcaster Mini-App...
        </footer>
      </div>
    );
  }

  // ACTIVE TABLE GAMEPLAY VIEW
  return (
    <div className="flex flex-col h-screen w-full relative overflow-hidden bg-[url('https://i.imgur.com/k2j4j3V.jpeg')] bg-cover bg-center">
      <div className="absolute inset-0 bg-black bg-opacity-60 z-0 pointer-events-none"></div>

      <div className="z-10 flex flex-col items-center justify-between h-full p-4 overflow-y-auto">
        <div className="w-full max-w-md shrink-0 mb-3">
          {runtimeChrome}
        </div>

        {/* Header bar */}
        <div className="flex justify-between items-center w-full max-w-md shrink-0">
          <span className="text-xs text-gray-400 font-bold bg-gray-950 px-3 py-1 rounded-full border border-gray-900">
            🏆 {tableName}
          </span>
          {currentBlinds && (
            <div className="text-[10px] text-gray-400 font-bold bg-gray-950 px-2 py-1 rounded-full border border-gray-900 mx-2 text-center">
              Blinds: <span className="text-yellow-500">${currentBlinds.sb}/${currentBlinds.bb}</span>
              {currentBlinds.ante > 0 && ` (Ante $${currentBlinds.ante})`}
              <span className="block text-gray-500 mt-0.5">
                Next: {Math.floor(nextLevelInSecs / 60).toString().padStart(2, '0')}:{(nextLevelInSecs % 60).toString().padStart(2, '0')}
              </span>
            </div>
          )}
          <div className="flex space-x-2 shrink-0">
            <button
              onClick={() => setIsTrainingMode(!isTrainingMode)}
              className={`text-[10px] font-bold px-2 py-1 rounded-full border ${isTrainingMode ? 'bg-yellow-600 border-yellow-500 text-white shadow-[0_0_10px_rgba(202,138,4,0.5)]' : 'bg-gray-950 border-gray-900 text-gray-600'}`}
            >
              {isTrainingMode ? 'Training ON' : 'Training OFF'}
            </button>
            <button
              onClick={handleLeaveTable}
              className="text-xs text-red-400 font-bold bg-gray-950 px-3 py-1 rounded-full border border-gray-900 hover:bg-red-950"
            >
              Leave
            </button>
          </div>
        </div>

        {/* Opponents Rendering */}
        <div className="flex w-full justify-around mt-4 shrink-0">
          {seatedPlayers.filter(p => p.fid !== (universalUser.fid)).map((opponent) => (
            <div key={opponent.fid} className={`flex flex-col items-center transition-opacity ${opponent.status === 'folded' ? 'opacity-40' : 'opacity-100'}`}>
              <div className="relative">
                {opponent.pfp_url ? (
                  <img src={opponent.pfp_url} alt="Pfp" className={`w-12 h-12 rounded-full border-2 ${currentTurnFid === opponent.fid ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)]' : 'border-gray-700'}`} />
                ) : (
                  <div className={`w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center font-bold text-lg border-2 ${currentTurnFid === opponent.fid ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)]' : 'border-gray-700'}`}>
                    {opponent.username[0]}
                  </div>
                )}
                {/* Current Bet Indicator */}
                {opponent.current_bet > 0 && (
                  <div className="absolute -bottom-2 -right-2 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-blue-400 shadow-sm">
                    ${opponent.current_bet}
                  </div>
                )}
              </div>

              <div className="mt-1 text-center">
                <div className="text-[10px] text-gray-300 font-bold truncate w-16">@{opponent.username}</div>
                <div className="text-[10px] text-yellow-500 font-bold">${opponent.stack_size}</div>
              </div>

              {/* Hole Cards */}
              <div className="flex space-x-1 mt-1">
                {opponent.hand && opponent.status === 'playing' ? (
                  opponent.hand.split(",").map((card: string, i: number) => {
                    const isVisible = isTrainingMode || phase === "showdown";
                    if (!isVisible) {
                      return (
                        <div key={i} className="bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-800 to-red-950 w-6 h-8 rounded border border-gray-600 flex items-center justify-center shadow">
                          <span className="text-gray-900 text-[6px] font-bold tracking-widest opacity-30">ZAO</span>
                        </div>
                      );
                    } else {
                      const { rank, suitSymbol, isRed } = getCardDisplay(card);
                      return (
                        <div key={i} className={`bg-white font-bold text-[10px] w-6 h-8 rounded border border-gray-300 flex items-center justify-center shadow ${isRed ? "text-red-600" : "text-black"}`}>
                          {rank}{suitSymbol}
                        </div>
                      );
                    }
                  })
                ) : opponent.status === 'folded' ? (
                  <div className="text-[8px] text-gray-600 italic">Folded</div>
                ) : (
                  <div className="text-[8px] text-gray-600 italic">No Cards</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Table & Community Cards */}
        <div className="mt-2 flex flex-col items-center shrink-0 w-full">
          <div className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">
            Street: <span className="text-yellow-500 font-bold">{phase}</span>
          </div>

          <div className="bg-green-800 bg-opacity-80 rounded-full w-full max-w-sm h-40 flex items-center justify-center shadow-2xl border-4 border-green-900 relative">
            <div className="flex space-x-2">
              {board.length === 0 ? (
                <span className="text-green-200 text-sm italic">Waiting for Flop...</span>
              ) : (
                board.map((card, i) => {
                  const { rank, suitSymbol, isRed } = getCardDisplay(card);
                  return (
                    <div
                      key={i}
                      className={`bg-white font-bold text-lg w-12 h-16 rounded shadow flex items-center justify-center ${isRed ? "text-red-600" : "text-black"
                        }`}
                    >
                      {rank}{suitSymbol}
                    </div>
                  );
                })
              )}
            </div>
            <div className="absolute -bottom-8 bg-gray-900 px-4 py-1 rounded-full border border-gray-700">
              <span className="text-yellow-400 font-bold text-lg">Pot: ${potSize}</span>
            </div>
          </div>
        </div>

        {/* Coach Dashboard */}
        {coachFeedback && selectedTableId === "room_1" && (
          <div className="w-full max-w-md mt-6 p-4 bg-gray-900 border border-purple-500 rounded-lg shadow-xl shrink-0">
            <h3 className="text-purple-400 font-bold text-lg mb-2 flex items-center">
              <span className="mr-2">🤖</span> PokerCoachJohnny (CFR Analysis)
            </h3>
            <p className="text-gray-300 text-sm italic mb-2">"{coachFeedback.analysis || "That was an interesting move..."}"</p>
            {coachFeedback.gto && coachFeedback.gto.equity !== undefined && (
              <div className="bg-gray-800 p-2 rounded border border-gray-700">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">Hand Equity (vs Random):</span>
                  <span className="text-green-400 font-bold">{(coachFeedback.gto.equity * 100).toFixed(1)}%</span>
                </div>
              </div>
            )}
            <div className="mt-2 flex space-x-2">
              {coachFeedback.tags?.map((tag: string, i: number) => (
                <span key={i} className="text-xs px-2 py-1 bg-purple-900 text-purple-200 rounded-full">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* Player Hand */}
        <div className="mb-6 flex flex-col items-center">
          <div className="flex items-center justify-center space-x-2 mb-2">
            {universalUser.avatarUrl && (
              <img src={universalUser.avatarUrl} alt="Avatar" className="w-6 h-6 rounded-full" />
            )}
            <p className="text-sm text-green-200">
              {universalUser.authSource === "farcaster" ? `@${universalUser.username}` : universalUser.displayName}
            </p>
          </div>
          <div className="flex justify-center space-x-2">
            {playerCards.length === 0 ? (
              <span className="text-gray-400 text-xs italic">Dealing hole cards...</span>
            ) : (
              playerCards.map((card, i) => {
                const { rank, suitSymbol, isRed } = getCardDisplay(card);
                return (
                  <div
                    key={i}
                    className={`bg-white font-bold text-xl w-14 h-20 rounded-lg shadow-lg border-2 border-gray-300 flex items-center justify-center ${isRed ? "text-red-600" : "text-black"
                      }`}
                  >
                    {rank}{suitSymbol}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Dynamic No-Limit Hold'em HUD */}
        <div className="glass-panel w-full max-w-md p-3 mb-2">
          {phase === "showdown" ? (
            <div className="text-center space-y-3 py-2">
                  {lastHandResult === "win" ? (
                    <p className="text-green-400 font-bold text-lg">You Won! 🏆</p>
                  ) : lastHandResult === "loss" ? (
                    <p className="text-red-400 font-bold text-lg">You Lost 😔</p>
                  ) : lastHandResult === "split" ? (
                    <p className="text-yellow-400 font-bold text-lg">Split Pot! 🤝</p>
                  ) : (
                    <p className="text-gray-300 font-bold text-lg">Hand Over — Cards Revealed</p>
                  )}
                  <button
                    onClick={handleNextHand}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg shadow-lg text-lg animate-bounce"
                  >
                    Start Next Hand 🚀
                  </button>
            </div>
          ) : (
            <div className="flex flex-col space-y-2">
                  <div className="flex justify-between items-center text-xs text-gray-400 px-1">
                    <span>To Call: <span className="text-yellow-400 font-bold">${toCall}</span></span>
                    <span>Active Bet: <span className="text-blue-400 font-bold">${currentBet}</span></span>
                  </div>

                  {Number(currentTurnFid) !== Number(universalUser.fid) ? (
                    <div className="flex items-center justify-center p-4 bg-gray-800 rounded-lg">
                      <span className="text-gray-400 font-semibold animate-pulse">Waiting for other players...</span>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleAction("fold")}
                          className="bg-red-700 hover:bg-red-800 text-white font-bold py-2 rounded-lg text-sm"
                        >
                          Fold
                        </button>

                        {toCall === 0 ? (
                          <button
                            onClick={() => handleAction("check")}
                            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg text-sm"
                          >
                            Check
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAction("call")}
                            className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 rounded-lg text-sm"
                          >
                            Call (${toCall})
                          </button>
                        )}
                      </div>

                      {/* Betting & Raising presets — amounts based on actual blind level */}
                      <div className="grid grid-cols-4 gap-1.5 pt-1">
                        {(() => {
                          const bb = currentBlinds?.bb ?? 50;
                          const bet2bb = playerCurrentBet + bb * 2;
                          const bet3bb = playerCurrentBet + bb * 3;
                          const betPot = playerCurrentBet + Math.max(potSize, bb * 2);
                          const raiseMin = Math.max(currentBet * 2, currentBet + bb);
                          const raisePot = currentBet + toCall + potSize;
                          return toCall === 0 ? (
                            <>
                              <button onClick={() => handleAction("bet", bet2bb)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1.5 rounded">
                                2BB (${bet2bb})
                              </button>
                              <button onClick={() => handleAction("bet", bet3bb)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1.5 rounded">
                                3BB (${bet3bb})
                              </button>
                              <button onClick={() => handleAction("bet", betPot)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1.5 rounded">
                                Pot (${betPot})
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => handleAction("raise", raiseMin)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-1.5 rounded">
                                Min (${raiseMin})
                              </button>
                              <button onClick={() => handleAction("raise", currentBet * 3)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-1.5 rounded">
                                3x (${currentBet * 3})
                              </button>
                              <button onClick={() => handleAction("raise", raisePot)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-1.5 rounded">
                                Pot (${raisePot})
                              </button>
                            </>
                          );
                        })()}
                        <button
                          onClick={() => handleAction("all_in")}
                          className="bg-red-900 hover:bg-red-950 text-white text-xs font-bold py-1.5 rounded"
                        >
                          All In (${playerStack})
                        </button>
                      </div>
                    </>
                  )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
