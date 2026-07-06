"use client";

import { useEffect, useState } from "react";
import { getApiUrl } from "~/lib/env";
import { useUniversalUser } from "~/hooks/useUniversalUser";

type HandRow = {
  id: number;
  tableId: string;
  holeCards: string[];
  board: string[];
  result: "win" | "loss" | "split";
  netAmount: number;
  potSize: number;
  phaseReached: string;
  resolution: string;
  createdAt: string;
};

function cardLabel(card: string) {
  if (!card || card.length < 2) return card;
  const rank = card[0] === "T" ? "10" : card[0];
  const suitSymbol = { h: "♥", d: "♦", c: "♣", s: "♠" }[card[1]] ?? "";
  const isRed = card[1] === "h" || card[1] === "d";
  return { rank, suitSymbol, isRed };
}

function MiniCard({ card }: { card: string }) {
  const display = cardLabel(card);
  if (typeof display === "string") return null;
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-8 rounded bg-white text-xs font-bold ${
        display.isRed ? "text-red-600" : "text-black"
      }`}
    >
      {display.rank}{display.suitSymbol}
    </span>
  );
}

const RESULT_STYLES: Record<HandRow["result"], string> = {
  win: "text-neon-green border-neon-green/40 bg-neon-green/10",
  loss: "text-red-400 border-red-500/40 bg-red-500/10",
  split: "text-neon-gold border-neon-gold/40 bg-neon-gold/10",
};

export function HandAnalysisTab() {
  const universalUser = useUniversalUser();
  const [hands, setHands] = useState<HandRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const fetchHands = async () => {
      try {
        const res = await fetch(getApiUrl(`/api/stats/hands?fid=${universalUser.fid}&limit=25`));
        const json = await res.json();
        if (!cancelled && json.success) {
          setHands(json.hands);
          setError("");
        } else if (!cancelled) {
          setError(json.error || "Unable to load hand history");
        }
      } catch {
        if (!cancelled) setError("Unable to connect to the stats service");
      }
    };
    fetchHands();
    const interval = setInterval(fetchHands, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [universalUser.fid]);

  return (
    <div className="flex flex-col gap-3 px-1 pb-4">
      <div className="glass-panel p-4">
        <h2 className="text-sm font-semibold text-primary-light uppercase tracking-widest">
          Hand Analysis
        </h2>
        <p className="text-xs text-gray-500 mt-1">Every resolved hand, fold or showdown.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {hands.length === 0 && !error && (
        <div className="text-center text-gray-500 py-10 text-sm">
          No hands played yet — join a table to start building your history.
        </div>
      )}

      {hands.map((hand) => (
        <div key={hand.id} className="glass-panel p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {hand.holeCards.map((card, i) => (
              <MiniCard key={i} card={card} />
            ))}
          </div>

          <div className="flex-1 text-xs text-gray-400">
            <div className="text-gray-300">
              {hand.resolution === "showdown" ? "Showdown" : "Opponent folded"} · {hand.phaseReached}
            </div>
            <div className="text-gray-500">{new Date(hand.createdAt).toLocaleString()}</div>
          </div>

          <div className="text-right">
            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${RESULT_STYLES[hand.result]}`}>
              {hand.result}
            </span>
            <div
              className={`text-sm font-bold mt-1 ${hand.netAmount >= 0 ? "text-neon-green" : "text-red-400"}`}
            >
              {hand.netAmount >= 0 ? "+" : ""}
              {hand.netAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
