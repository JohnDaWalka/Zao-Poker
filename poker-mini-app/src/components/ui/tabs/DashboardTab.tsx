"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Flame, Trophy, Wallet } from "lucide-react";
import { useUniversalUser } from "~/hooks/useUniversalUser";
import { LineAreaChart } from "~/components/ui/charts/LineAreaChart";

type DashboardData = {
  netWinnings: number;
  handsPlayed: number;
  handsWon: number;
  winRate: number;
  biggestPotWon: number;
  currentStreak: number;
  bestStreak: number;
  recentTrend: number[];
};

function formatChips(amount: number) {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function DashboardTab() {
  const universalUser = useUniversalUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const fetchDashboard = async () => {
      try {
        const res = await fetch(`/api/stats/dashboard?fid=${universalUser.fid}`);
        const json = await res.json();
        if (!cancelled && json.success) {
          setData(json.dashboard);
          setError("");
        } else if (!cancelled) {
          setError(json.error || "Unable to load dashboard");
        }
      } catch {
        if (!cancelled) setError("Unable to connect to the stats service");
      }
    };
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [universalUser.fid]);

  return (
    <div className="flex flex-col gap-4 px-1 pb-4">
      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-400">
          <Wallet className="w-3.5 h-3.5 text-primary-light" />
          Net Winnings
        </div>
        <div className="text-4xl font-extrabold text-primary-light drop-shadow-[0_0_10px_rgba(34,211,238,0.4)] mt-1">
          {data ? `$${formatChips(data.netWinnings)}` : "—"}
        </div>
        {data && data.recentTrend.length > 1 && (
          <div className="mt-3">
            <LineAreaChart data={data.recentTrend} width={300} height={80} />
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="glass-panel p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Hands Played</div>
          <div className="text-2xl font-bold text-white mt-1">{data?.handsPlayed ?? "—"}</div>
        </div>
        <div className="glass-panel p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Win Rate</div>
          <div className="text-2xl font-bold text-neon-green mt-1">
            {data ? `${(data.winRate * 100).toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="glass-panel p-4">
          <div className="flex items-center gap-1 text-xs text-gray-400 uppercase tracking-wide">
            <Flame className="w-3.5 h-3.5 text-neon-gold" /> Current Streak
          </div>
          <div className="text-2xl font-bold text-neon-gold mt-1">{data?.currentStreak ?? "—"}</div>
        </div>
        <div className="glass-panel p-4">
          <div className="flex items-center gap-1 text-xs text-gray-400 uppercase tracking-wide">
            <Trophy className="w-3.5 h-3.5 text-neon-gold" /> Biggest Pot
          </div>
          <div className="text-2xl font-bold text-white mt-1">
            {data ? `$${formatChips(data.biggestPotWon)}` : "—"}
          </div>
        </div>
      </div>

      <div className="glass-panel p-4 flex items-start gap-3">
        <FlaskConical className="w-5 h-5 text-primary-light mt-0.5 shrink-0" />
        <p className="text-sm text-gray-300">
          Chemist's mind, player's heart. Every hand you play here feeds your Hand Analysis and
          Leaderboard rank — head to a table to keep building your edge.
        </p>
      </div>
    </div>
  );
}
