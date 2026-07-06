"use client";

import { useEffect, useState, type ReactElement } from "react";
import { getApiUrl } from "~/lib/env";
import { Award, Medal, Trophy } from "lucide-react";
import { useUniversalUser } from "~/hooks/useUniversalUser";

type LeaderboardEntry = {
  rank: number;
  fid: number;
  username: string;
  pfpUrl: string;
  handsPlayed: number;
  handsWon: number;
  netWinnings: number;
  bestStreak: number;
};

const RANK_ICON: Record<number, ReactElement> = {
  1: <Trophy className="w-5 h-5 text-neon-gold" />,
  2: <Medal className="w-5 h-5 text-gray-300" />,
  3: <Award className="w-5 h-5 text-amber-600" />,
};

export function LeaderboardsTab() {
  const universalUser = useUniversalUser();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [viewerRank, setViewerRank] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch(getApiUrl(`/api/stats/leaderboard?fid=${universalUser.fid}&limit=20`));
        const json = await res.json();
        if (!cancelled && json.success) {
          setLeaderboard(json.leaderboard);
          setViewerRank(json.viewerRank);
          setError("");
        } else if (!cancelled) {
          setError(json.error || "Unable to load leaderboard");
        }
      } catch {
        if (!cancelled) setError("Unable to connect to the stats service");
      }
    };
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [universalUser.fid]);

  const viewerInTop = leaderboard.some((entry) => entry.fid === universalUser.fid);

  return (
    <div className="flex flex-col gap-3 px-1 pb-4">
      <div className="glass-panel p-4">
        <h2 className="text-sm font-semibold text-primary-light uppercase tracking-widest">
          Leaderboards
        </h2>
        <p className="text-xs text-gray-500 mt-1">Ranked by net winnings across every table.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {leaderboard.length === 0 && !error && (
        <div className="text-center text-gray-500 py-10 text-sm">
          No ranked players yet — be the first to finish a hand.
        </div>
      )}

      {leaderboard.map((entry) => {
        const isViewer = entry.fid === universalUser.fid;
        return (
          <div
            key={entry.fid}
            className={`glass-panel p-3 flex items-center gap-3 ${
              isViewer ? "border-primary/50 shadow-glow" : ""
            }`}
          >
            <div className="w-8 flex justify-center">
              {RANK_ICON[entry.rank] ?? (
                <span className="text-sm font-bold text-gray-500">#{entry.rank}</span>
              )}
            </div>

            {entry.pfpUrl ? (
              <img src={entry.pfpUrl} alt="" className="w-9 h-9 rounded-full border border-primary/30" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold">
                {entry.username[0]?.toUpperCase()}
              </div>
            )}

            <div className="flex-1">
              <div className="text-sm font-bold text-gray-200">
                @{entry.username}
                {isViewer && <span className="text-primary-light text-xs ml-1">(you)</span>}
              </div>
              <div className="text-xs text-gray-500">
                {entry.handsWon}/{entry.handsPlayed} hands won · best streak {entry.bestStreak}
              </div>
            </div>

            <div
              className={`text-sm font-bold ${entry.netWinnings >= 0 ? "text-neon-green" : "text-red-400"}`}
            >
              {entry.netWinnings >= 0 ? "+" : ""}
              {entry.netWinnings.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </div>
          </div>
        );
      })}

      {!viewerInTop && viewerRank && (
        <div className="glass-panel p-3 flex items-center gap-3 border-primary/50">
          <div className="w-8 flex justify-center text-sm font-bold text-primary-light">
            #{viewerRank}
          </div>
          <div className="text-sm text-gray-300">Your current rank</div>
        </div>
      )}
    </div>
  );
}
