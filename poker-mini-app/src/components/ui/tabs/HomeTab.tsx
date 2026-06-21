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

export function HomeTab() {
  const { context } = useMiniApp();
  const { user: neynarUser } = useNeynarUser(context || undefined);
  const [gameState, setGameState] = useState<"lobby" | "table">("lobby");
  const [potSize, setPotSize] = useState(0);
  const [playerStack, setPlayerStack] = useState(5000);
  const [coachFeedback, setCoachFeedback] = useState<any>(null);
  
  // Game loop states
  const [board, setBoard] = useState<string[]>([]);
  const [playerCards, setPlayerCards] = useState<string[]>([]);
  const [phase, setPhase] = useState<string>("preflop");
  
  // Betting states
  const [currentBet, setCurrentBet] = useState(0);
  const [playerCurrentBet, setPlayerCurrentBet] = useState(0);

  // Poll database for table state
  useEffect(() => {
    if (gameState !== "table") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/table");
        const data = await res.json();
        if (data.success) {
          setPotSize(data.gameState.pot_size);
          setPhase(data.gameState.phase);
          setCurrentBet(data.gameState.current_bet || 0);
          setBoard(data.gameState.board ? data.gameState.board.split(",") : []);

          const me = data.players.find((p: any) => p.fid === (context?.user?.fid || 9999));
          if (me) {
            setPlayerStack(me.stack_size);
            setPlayerCurrentBet(me.current_bet || 0);
            setPlayerCards(me.hand ? me.hand.split(",") : []);
          }
        }
      } catch (e) {}
    }, 1500); // Snappy polling
    return () => clearInterval(interval);
  }, [gameState, context?.user?.fid]);

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
    } catch (e) {
      console.error("Event error:", e);
    }
  };

  const triggerNotification = async () => {
    if (!context?.user?.fid) return;
    try {
      await fetch("/api/send-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid: context.user.fid,
          notificationDetails: { token: "mock-token", url: "mock-url" }
        }),
      });
    } catch (e) {
      console.error("Failed to push notification", e);
    }
  };

  const handleJoinTable = async () => {
    sendEvent({ action: "user_joined_table" });
    
    // Add player to DB
    const res = await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fid: context?.user?.fid || 9999, action: "join" })
    });
    
    const data = await res.json();
    if (data.success) {
      setPotSize(data.gameState.pot_size);
      setPhase(data.gameState.phase);
      setCurrentBet(data.gameState.current_bet || 0);
      setBoard(data.gameState.board ? data.gameState.board.split(",") : []);
      const me = data.players.find((p: any) => p.fid === (context?.user?.fid || 9999));
      if (me) {
        setPlayerStack(me.stack_size);
        setPlayerCurrentBet(me.current_bet || 0);
        setPlayerCards(me.hand ? me.hand.split(",") : []);
      }
    }

    setGameState("table");
  };

  const handleNextHand = async () => {
    setCoachFeedback(null);
    const res = await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fid: context?.user?.fid || 9999, action: "deal" })
    });
    const data = await res.json();
    if (data.success) {
      setPotSize(data.gameState.pot_size);
      setPhase(data.gameState.phase);
      setCurrentBet(data.gameState.current_bet || 0);
      setBoard(data.gameState.board ? data.gameState.board.split(",") : []);
      const me = data.players.find((p: any) => p.fid === (context?.user?.fid || 9999));
      if (me) {
        setPlayerStack(me.stack_size);
        setPlayerCurrentBet(me.current_bet || 0);
        setPlayerCards(me.hand ? me.hand.split(",") : []);
      }
    }
  };

  const handleAction = async (action: string, customAmount?: number) => {
    sendEvent({ action });
    triggerNotification();

    if (action === "fold") {
      await fetch("/api/table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fid: context?.user?.fid || 9999, action })
      });
      setGameState("lobby");
      return;
    }

    // Determine final bet amount based on Hold'em action
    let amount = 0;
    const toCall = currentBet - playerCurrentBet;

    if (action === "call") {
      amount = toCall;
    } else if (action === "bet" || action === "raise") {
      amount = customAmount || 0;
    } else if (action === "all_in") {
      amount = playerStack;
    }

    // Update DB
    const res = await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fid: context?.user?.fid || 9999, action, amount })
    });

    const data = await res.json();
    if (data.success) {
      setPotSize(data.gameState.pot_size);
      setPhase(data.gameState.phase);
      setCurrentBet(data.gameState.current_bet || 0);
      setBoard(data.gameState.board ? data.gameState.board.split(",") : []);
      const me = data.players.find((p: any) => p.fid === (context?.user?.fid || 9999));
      if (me) {
        setPlayerStack(me.stack_size);
        setPlayerCurrentBet(me.current_bet || 0);
        setPlayerCards(me.hand ? me.hand.split(",") : []);
      }
    }

    // Call Python backend for analysis
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
      console.log("Coach Feedback:", resData);
      setCoachFeedback(resData);
    } catch (e) {
      console.error("Coach API error:", e);
    }
  };

  // No-Limit Hold'em Action HUD Mapping
  const toCall = currentBet - playerCurrentBet;

  if (gameState === "lobby") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
        <h1 className="text-3xl font-bold mb-4">ZAO Poker 6-Max Tournament Circuit</h1>
        <p className="mb-6 text-gray-400">Join the table to start playing.</p>
        <button
          onClick={handleJoinTable}
          className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform transform hover:scale-105"
        >
          Join Table
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full relative overflow-hidden bg-[url('https://i.imgur.com/k2j4j3V.jpeg')] bg-cover bg-center">
      <div className="absolute inset-0 bg-black bg-opacity-60 z-0 pointer-events-none"></div>
      
      <div className="z-10 flex flex-col items-center justify-between h-full p-4 overflow-y-auto">
        
        {/* Table & Community Cards */}
        <div className="mt-4 flex flex-col items-center shrink-0 w-full">
          <div className="text-sm font-semibold tracking-widest text-gray-400 uppercase mb-2">
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
          <div className="w-full max-w-md mt-8 p-4 bg-gray-900 border border-purple-500 rounded-lg shadow-xl shrink-0">
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
        <div className="w-full max-w-md bg-gray-900 bg-opacity-95 p-3 rounded-lg border border-gray-800">
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