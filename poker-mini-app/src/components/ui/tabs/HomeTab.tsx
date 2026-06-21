"use client";

import { useState, useEffect } from "react";
import { useMiniApp } from "@neynar/react";
import { useNeynarUser } from "~/hooks/useNeynarUser";

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
}

export function HomeTab() {
  const { context } = useMiniApp();
  const { user: neynarUser } = useNeynarUser(context || undefined);
  
  // Navigation states
  const [gameState, setGameState] = useState<"lobby" | "table">("lobby");
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  
  // Lobby states
  const [lobbyTables, setLobbyTables] = useState<TableData[]>([]);
  
  // Active table states
  const [tableStatus, setTableStatus] = useState<string>("waiting");
  const [tableName, setTableName] = useState<string>("");
  const [maxPlayers, setMaxPlayers] = useState<number>(6);
  const [potSize, setPotSize] = useState(0);
  const [playerStack, setPlayerStack] = useState(5000);
  const [coachFeedback, setCoachFeedback] = useState<any>(null);
  
  // Game loop states
  const [board, setBoard] = useState<string[]>([]);
  const [playerCards, setPlayerCards] = useState<string[]>([]);
  const [phase, setPhase] = useState<string>("preflop");
  const [currentBet, setCurrentBet] = useState(0);
  const [playerCurrentBet, setPlayerCurrentBet] = useState(0);
  const [seatedPlayers, setSeatedPlayers] = useState<any[]>([]);

  // 1. Poll Lobby list
  useEffect(() => {
    if (gameState !== "lobby") return;
    const fetchLobby = async () => {
      try {
        const res = await fetch("/api/table");
        const data = await res.json();
        if (data.success) {
          setLobbyTables(data.tables);
        }
      } catch (e) {}
    };
    fetchLobby();
    const interval = setInterval(fetchLobby, 4000);
    return () => clearInterval(interval);
  }, [gameState]);

  // 2. Poll Active Table / Waiting Room state
  useEffect(() => {
    if (gameState !== "table" || !selectedTableId) return;
    const fetchTableState = async () => {
      try {
        const res = await fetch(`/api/table?table_id=${selectedTableId}`);
        const data = await res.json();
        if (data.success && data.gameState) {
          setTableName(data.gameState.name);
          setMaxPlayers(data.gameState.max_players);
          setTableStatus(data.gameState.status);
          setPotSize(data.gameState.pot_size);
          setPhase(data.gameState.phase);
          setCurrentBet(data.gameState.current_bet || 0);
          setBoard(data.gameState.board ? data.gameState.board.split(",") : []);
          setSeatedPlayers(data.players || []);

          const userFid = context?.user?.fid || 9999;
          const me = data.players.find((p: any) => p.fid === userFid);
          if (me) {
            setPlayerStack(me.stack_size);
            setPlayerCurrentBet(me.current_bet || 0);
            setPlayerCards(me.hand ? me.hand.split(",") : []);
          }
        }
      } catch (e) {}
    };
    fetchTableState();
    const interval = setInterval(fetchTableState, 1500);
    return () => clearInterval(interval);
  }, [gameState, selectedTableId, context?.user?.fid]);

  const sendEvent = async (eventData: any) => {
    try {
      await fetch(
        "https://api.neynar.com/f/app/ded91835-5060-4c07-ae3c-f45ca0935ec2/event",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid: context?.user?.fid,
            ...eventData,
          }),
        }
      );
    } catch (e) {}
  };

  const handleJoinTable = async (tableId: string) => {
    setSelectedTableId(tableId);
    setGameState("table");

    const payload = {
      fid: context?.user?.fid || 9999,
      username: neynarUser?.username || `User#${context?.user?.fid || 9999}`,
      pfp_url: neynarUser?.pfp_url || "",
      table_id: tableId,
      action: "join"
    };

    sendEvent({ action: "user_joined_table", table_id: tableId });

    const res = await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (data.success && data.gameState) {
      setTableName(data.gameState.name);
      setTableStatus(data.gameState.status);
      setPotSize(data.gameState.pot_size);
      setPhase(data.gameState.phase);
      setBoard(data.gameState.board ? data.gameState.board.split(",") : []);
      setSeatedPlayers(data.players || []);
    }
  };

  const handleLeaveTable = async () => {
    sendEvent({ action: "user_left_table", table_id: selectedTableId });
    await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fid: context?.user?.fid || 9999,
        table_id: selectedTableId,
        action: "fold"
      })
    });
    setGameState("lobby");
    setSelectedTableId("");
    setCoachFeedback(null);
  };

  const handleStartPractice = async () => {
    await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fid: context?.user?.fid || 9999,
        table_id: selectedTableId,
        action: "deal"
      })
    });
  };

  const handleNextHand = async () => {
    setCoachFeedback(null);
    const res = await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fid: context?.user?.fid || 9999,
        table_id: selectedTableId,
        action: "deal"
      })
    });
    const data = await res.json();
    if (data.success && data.gameState) {
      setPotSize(data.gameState.pot_size);
      setPhase(data.gameState.phase);
      setCurrentBet(data.gameState.current_bet || 0);
      setBoard(data.gameState.board ? data.gameState.board.split(",") : []);
    }
  };

  const handleAction = async (action: string, customAmount?: number) => {
    sendEvent({ action });
    if (action === "fold") {
      await handleLeaveTable();
      return;
    }

    let amount = 0;
    const toCall = currentBet - playerCurrentBet;

    if (action === "call") {
      amount = toCall;
    } else if (action === "bet" || action === "raise") {
      amount = customAmount || 0;
    } else if (action === "all_in") {
      amount = playerStack;
    }

    const res = await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fid: context?.user?.fid || 9999,
        table_id: selectedTableId,
        action,
        amount
      })
    });

    const data = await res.json();
    if (data.success && data.gameState) {
      setPotSize(data.gameState.pot_size);
      setPhase(data.gameState.phase);
      setCurrentBet(data.gameState.current_bet || 0);
      setBoard(data.gameState.board ? data.gameState.board.split(",") : []);
    }

    try {
      const resAnalyze = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid: context?.user?.fid || 9999,
          action: action === "check" ? "check" : (action === "call" ? "call" : "bet"),
          amount: amount,
          pot_size: potSize + amount,
          stack_size: playerStack - amount,
          cards: playerCards
        })
      });
      const resData = await resAnalyze.json();
      setCoachFeedback(resData);
    } catch (e) {}
  };

  const toCall = currentBet - playerCurrentBet;

  // LOBBY VIEW
  if (gameState === "lobby") {
    return (
      <div className="flex flex-col min-h-screen bg-gray-950 text-white p-4">
        <header className="py-6 text-center border-b border-gray-900 mb-6">
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-blue-500">
            ZAO Poker Tournament Lobby
          </h1>
          <p className="text-xs text-gray-500 mt-1">Select a tournament table to join from your Farcaster ID</p>
        </header>

        <div className="flex-1 flex flex-col space-y-4 max-w-md mx-auto w-full">
          {lobbyTables.length === 0 ? (
            <div className="text-center text-gray-500 py-10">Loading active tournaments...</div>
          ) : (
            lobbyTables.map((table) => (
              <div
                key={table.id}
                className="bg-gray-900 border border-gray-800 hover:border-gray-700 p-4 rounded-xl flex flex-col justify-between shadow-lg transition-all"
              >
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-lg text-gray-200">{table.name}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase ${
                      table.status === "playing"
                        ? "bg-yellow-900 text-yellow-200"
                        : "bg-green-900 text-green-200"
                    }`}
                  >
                    {table.status}
                  </span>
                </div>

                <div className="flex justify-between items-center mt-2">
                  <div className="text-sm text-gray-400">
                    Seated: <span className="text-white font-bold">{table.player_count}/{table.max_players}</span>
                  </div>
                  <button
                    onClick={() => handleJoinTable(table.id)}
                    className="bg-green-600 hover:bg-green-700 text-white text-sm font-bold py-2 px-5 rounded-lg shadow transition-transform transform active:scale-95"
                  >
                    Join Table
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
      <div className="flex flex-col min-h-screen bg-gray-950 text-white p-4 justify-between">
        <header className="py-4 text-center border-b border-gray-900">
          <h2 className="text-xl font-bold text-gray-300">Waiting Room</h2>
          <p className="text-sm text-yellow-500 font-semibold">{tableName}</p>
        </header>

        <div className="my-auto max-w-md mx-auto w-full p-4 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl">
          <h3 className="text-sm font-semibold tracking-wider text-gray-500 uppercase mb-4 text-center">
            Seated Players ({seatedPlayers.length}/{maxPlayers})
          </h3>

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
              onClick={handleStartPractice}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg text-center text-sm shadow transition-transform transform active:scale-95"
            >
              Start Hand (Simulate Opponents) 🃏
            </button>
            <button
              onClick={handleLeaveTable}
              className="bg-gray-800 hover:bg-gray-700 text-gray-400 font-semibold py-2 rounded-lg text-center text-sm"
            >
              Leave Room
            </button>
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
        
        {/* Header bar */}
        <div className="flex justify-between items-center w-full max-w-md shrink-0">
          <span className="text-xs text-gray-400 font-bold bg-gray-950 px-3 py-1 rounded-full border border-gray-900">
            🏆 {tableName}
          </span>
          <button
            onClick={handleLeaveTable}
            className="text-xs text-red-400 font-bold bg-gray-950 px-3 py-1 rounded-full border border-gray-900 hover:bg-red-950"
          >
            Leave
          </button>
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
                      className={`bg-white font-bold text-lg w-12 h-16 rounded shadow flex items-center justify-center ${
                        isRed ? "text-red-600" : "text-black"
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
        {coachFeedback && (
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
            {neynarUser?.pfp_url && (
              <img src={neynarUser.pfp_url} alt="Avatar" className="w-6 h-6 rounded-full" />
            )}
            <p className="text-sm text-green-200">
              {neynarUser?.username ? `@${neynarUser.username}` : "Your Hand"}
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
                    className={`bg-white font-bold text-xl w-14 h-20 rounded-lg shadow-lg border-2 border-gray-300 flex items-center justify-center ${
                      isRed ? "text-red-600" : "text-black"
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
        <div className="w-full max-w-md bg-gray-900 bg-opacity-95 p-3 rounded-lg border border-gray-800 mb-2">
          {phase === "showdown" ? (
            <div className="text-center space-y-3 py-2">
              <p className="text-green-400 font-bold text-lg">
                {potSize === 0 ? "Opponent Folded! You Won! 🏆" : "Showdown! Cards revealed."}
              </p>
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

              {/* Betting & Raising presets */}
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {toCall === 0 ? (
                  <>
                    <button onClick={() => handleAction("bet", 100)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1.5 rounded">
                      Bet 2BB ($100)
                    </button>
                    <button onClick={() => handleAction("bet", 150)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1.5 rounded">
                      Bet 3BB ($150)
                    </button>
                    <button onClick={() => handleAction("bet", potSize)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1.5 rounded">
                      Bet Pot (${potSize})
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleAction("raise", currentBet + 100)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-1.5 rounded">
                      Raise +$100
                    </button>
                    <button onClick={() => handleAction("raise", currentBet * 2)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-1.5 rounded">
                      Raise Min (${currentBet * 2})
                    </button>
                    <button onClick={() => handleAction("raise", potSize + toCall * 2)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-1.5 rounded">
                      Raise Pot
                    </button>
                  </>
                )}
                <button
                  onClick={() => handleAction("all_in")}
                  className="bg-red-900 hover:bg-red-950 text-white text-xs font-bold py-1.5 rounded"
                >
                  All In (${playerStack})
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}