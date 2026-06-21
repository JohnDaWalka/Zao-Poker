"use client";

import { useState, useEffect } from "react";
import { useMiniApp } from "@neynar/react";
import { useNeynarUser } from "~/hooks/useNeynarUser";

export function HomeTab() {
  const { context } = useMiniApp();
  const { user: neynarUser } = useNeynarUser(context || undefined);
  const [gameState, setGameState] = useState<"lobby" | "table">("lobby");
  const [potSize, setPotSize] = useState(0);
  const [playerStack, setPlayerStack] = useState(5000);
  const [coachFeedback, setCoachFeedback] = useState<any>(null);

  // Poll database for table state
  useEffect(() => {
    if (gameState !== "table") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/table");
        const data = await res.json();
        if (data.success) {
          setPotSize(data.gameState.pot_size);
          const me = data.players.find((p: any) => p.fid === context?.user?.fid);
          if (me) setPlayerStack(me.stack_size);
        }
      } catch (e) {}
    }, 3000);
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
    await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fid: context?.user?.fid, action: "join" })
    });

    setGameState("table");
  };

  const handleAction = async (action: string) => {
    sendEvent({ action });
    triggerNotification(); // Simulate pushing a notification to the next player
    if (action === "fold") setGameState("lobby");

    // Call Python backend
    let amount = 0;
    if (action === "call") amount = 50;
    if (action === "raise") amount = 150;
    if (action === "overbet") amount = potSize * 2;
    if (action === "all_in") amount = playerStack;

    // Update DB
    await fetch("/api/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fid: context?.user?.fid || 0, action, amount })
    });

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid: context?.user?.fid || 0,
          action,
          amount,
          pot_size: potSize,
          stack_size: playerStack,
          cards: ["Ah", "Ac"]
        })
      });
      const data = await res.json();
      console.log("Coach Feedback:", data);
      setCoachFeedback(data);
    } catch (e) {
      console.error("Coach API error:", e);
    }
  };

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
        <div className="mt-4 flex flex-col items-center shrink-0">
          <div className="bg-green-800 bg-opacity-80 rounded-full w-80 h-40 flex items-center justify-center shadow-2xl border-4 border-green-900 relative">
            <div className="flex space-x-2">
              <div className="bg-white text-black font-bold text-lg w-12 h-16 rounded shadow flex items-center justify-center">10♠</div>
              <div className="bg-white text-red-600 font-bold text-lg w-12 h-16 rounded shadow flex items-center justify-center">J♥</div>
              <div className="bg-white text-black font-bold text-lg w-12 h-16 rounded shadow flex items-center justify-center">Q♠</div>
              <div className="bg-white text-red-600 font-bold text-lg w-12 h-16 rounded shadow flex items-center justify-center">K♦</div>
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
            {coachFeedback.gto && coachFeedback.gto.equity && (
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
        <div className="mb-6">
          <div className="flex items-center justify-center space-x-2 mb-2">
            {neynarUser?.pfp_url && (
              <img src={neynarUser.pfp_url} alt="Avatar" className="w-6 h-6 rounded-full" />
            )}
            <p className="text-sm text-green-200">
              {neynarUser?.username ? `@${neynarUser.username}` : "Your Hand"}
            </p>
          </div>
          <div className="flex justify-center space-x-2">
            <div className="bg-white text-red-600 font-bold text-xl w-14 h-20 rounded-lg shadow-lg border-2 border-gray-300 flex items-center justify-center">A♥</div>
            <div className="bg-white text-black font-bold text-xl w-14 h-20 rounded-lg shadow-lg border-2 border-gray-300 flex items-center justify-center">A♣</div>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 w-full max-w-md">
          <button onClick={() => handleAction("fold")} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow">
            Fold
          </button>
          <button onClick={() => handleAction("call")} className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg shadow">
            Call ($50)
          </button>
          <button onClick={() => handleAction("raise")} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow">
            Raise ($150)
          </button>
          <button onClick={() => handleAction("overbet")} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg shadow">
            Overbet
          </button>
          <button onClick={() => handleAction("all_in")} className="bg-red-800 hover:bg-red-900 text-white font-bold py-2 px-4 rounded-lg shadow">
            All In (Stack: ${playerStack})
          </button>
        </div>
      </div>
    </div>
  );
}