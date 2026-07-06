"use client";

import { useEffect, useState } from "react";
import { getApiUrl } from "~/lib/env";
import { useUniversalUser } from "~/hooks/useUniversalUser";
import { LineAreaChart } from "~/components/ui/charts/LineAreaChart";

type AnalyticsData = {
  rangeDays: number;
  series: { day: string; net: number; hands: number; winRate: number }[];
  hands: number;
  winRate: number;
  netAmount: number;
  netPer100Hands: number;
  avgPotSize: number;
  biggestWin: number;
};

export function AnalyticsTab() {
  const universalUser = useUniversalUser();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const fetchAnalytics = async () => {
      try {
        const res = await fetch(getApiUrl(`/api/stats/analytics?fid=${universalUser.fid}&days=14`));
        const json = await res.json();
        if (!cancelled && json.success) {
          setData(json.analytics);
          setError("");
        } else if (!cancelled) {
          setError(json.error || "Unable to load analytics");
        }
      } catch {
        if (!cancelled) setError("Unable to connect to the stats service");
      }
    };
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [universalUser.fid]);

  const netSeries = data?.series.map((point) => point.net) ?? [];

  return (
    <div className="flex flex-col gap-4 px-1 pb-4">
      <div className="glass-panel p-5">
        <div className="text-xs uppercase tracking-widest text-gray-400">Net / 100 Hands</div>
        <div className="text-4xl font-extrabold text-primary-light drop-shadow-[0_0_10px_rgba(34,211,238,0.4)] mt-1">
          {data ? data.netPer100Hands.toFixed(1) : "—"}
        </div>
        <div className="text-xs text-gray-500 mt-1">Last {data?.rangeDays ?? 14} days</div>

        {netSeries.length > 1 && (
          <div className="mt-3">
            <LineAreaChart data={netSeries} width={300} height={90} />
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="glass-panel p-3 text-center">
          <div className="text-xl font-bold text-neon-green">
            {data ? `${(data.winRate * 100).toFixed(1)}%` : "—"}
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Win Rate</div>
        </div>
        <div className="glass-panel p-3 text-center">
          <div className="text-xl font-bold text-white">{data?.hands ?? "—"}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Hands</div>
        </div>
        <div className="glass-panel p-3 text-center">
          <div className="text-xl font-bold text-neon-gold">
            {data ? Math.round(data.avgPotSize) : "—"}
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Avg Pot</div>
        </div>
      </div>

      <div className="glass-panel p-4">
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-400">Net winnings ({data?.rangeDays ?? 14}d)</span>
          <span className={data && data.netAmount >= 0 ? "text-neon-green font-bold" : "text-red-400 font-bold"}>
            {data ? `${data.netAmount >= 0 ? "+" : ""}${Math.round(data.netAmount)}` : "—"}
          </span>
        </div>
        <div className="flex justify-between items-center text-sm mt-2">
          <span className="text-gray-400">Biggest single-hand win</span>
          <span className="text-neon-green font-bold">
            {data ? `+${Math.round(data.biggestWin)}` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
