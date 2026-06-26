"use client";

import { useEffect, useState } from "react";
import type { AuthSource } from "~/types/universal";

export type DashboardData = {
  netWinnings: number;
  handsPlayed: number;
  handsWon: number;
  winRate: number;
  biggestPotWon: number;
  currentStreak: number;
  bestStreak: number;
  recentTrend: number[];
};

export type AnalyticsPoint = {
  day: string;
  net: number;
  hands: number;
  winRate: number;
};

export type AnalyticsData = {
  rangeDays: number;
  series: AnalyticsPoint[];
  hands: number;
  winRate: number;
  netAmount: number;
  netPer100Hands: number;
  avgPotSize: number;
  biggestWin: number;
};

export type HandHistoryEntry = {
  id: number;
  tableId: string;
  holeCards: string[];
  board: string[];
  result: string;
  netAmount: number;
  potSize: number;
  phaseReached: string;
  resolution: string;
  createdAt: string;
};

export type LeaderboardEntry = {
  rank: number;
  fid: number;
  username: string;
  pfpUrl: string;
  handsPlayed: number;
  handsWon: number;
  netWinnings: number;
  bestStreak: number;
};

export type BestFriendEntry = {
  user: {
    fid: number;
    username: string;
  };
};

type DashboardResponse = {
  success: boolean;
  dashboard: DashboardData;
};

type AnalyticsResponse = {
  success: boolean;
  analytics: AnalyticsData;
};

type HandsResponse = {
  success: boolean;
  hands: HandHistoryEntry[];
};

type LeaderboardResponse = {
  success: boolean;
  leaderboard: LeaderboardEntry[];
  viewerRank: number | null;
};

type BestFriendsResponse = {
  bestFriends: BestFriendEntry[];
};

async function fetchJson<T>(url: string, label: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(label);
  }

  return (await response.json()) as T;
}

export function usePokerProductData(fid: number, authSource: AuthSource) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [hands, setHands] = useState<HandHistoryEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [viewerRank, setViewerRank] = useState<number | null>(null);
  const [bestFriends, setBestFriends] = useState<BestFriendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isSafeInteger(fid)) {
      setDashboard(null);
      setAnalytics(null);
      setHands([]);
      setLeaderboard([]);
      setViewerRank(null);
      setBestFriends([]);
      setLoading(false);
      setError("A valid player identity is required to load insights.");
      return;
    }

    const abortController = new AbortController();
    setDashboard(null);
    setAnalytics(null);
    setHands([]);
    setLeaderboard([]);
    setViewerRank(null);
    setBestFriends([]);
    setError(null);
    setLoading(true);

    async function load() {
      const requests = await Promise.allSettled([
        fetchJson<DashboardResponse>(
          `/api/stats/dashboard?fid=${encodeURIComponent(String(fid))}`,
          "dashboard",
          abortController.signal,
        ),
        fetchJson<AnalyticsResponse>(
          `/api/stats/analytics?fid=${encodeURIComponent(String(fid))}&days=14`,
          "analytics",
          abortController.signal,
        ),
        fetchJson<HandsResponse>(
          `/api/stats/hands?fid=${encodeURIComponent(String(fid))}&limit=8`,
          "hand history",
          abortController.signal,
        ),
        fetchJson<LeaderboardResponse>(
          `/api/stats/leaderboard?fid=${encodeURIComponent(String(fid))}&limit=12`,
          "leaderboard",
          abortController.signal,
        ),
        authSource === "farcaster"
          ? fetchJson<BestFriendsResponse>(
              `/api/best-friends?fid=${encodeURIComponent(String(fid))}`,
              "best friends",
              abortController.signal,
            )
          : Promise.resolve({ bestFriends: [] } satisfies BestFriendsResponse),
      ]);

      if (abortController.signal.aborted) {
        return;
      }

      const failures = requests
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : "product data",
        );

      const dashboardResult = requests[0];
      if (dashboardResult.status === "fulfilled") {
        setDashboard(dashboardResult.value.dashboard);
      }

      const analyticsResult = requests[1];
      if (analyticsResult.status === "fulfilled") {
        setAnalytics(analyticsResult.value.analytics);
      }

      const handsResult = requests[2];
      if (handsResult.status === "fulfilled") {
        setHands(handsResult.value.hands);
      }

      const leaderboardResult = requests[3];
      if (leaderboardResult.status === "fulfilled") {
        setLeaderboard(leaderboardResult.value.leaderboard);
        setViewerRank(leaderboardResult.value.viewerRank);
      }

      const friendsResult = requests[4];
      if (friendsResult.status === "fulfilled") {
        setBestFriends(friendsResult.value.bestFriends ?? []);
      }

      setError(
        failures.length > 0
          ? `Some product data is unavailable: ${failures.join(", ")}.`
          : null,
      );
      setLoading(false);
    }

    void load();

    return () => {
      abortController.abort();
    };
  }, [authSource, fid]);

  return {
    dashboard,
    analytics,
    hands,
    leaderboard,
    viewerRank,
    bestFriends,
    loading,
    error,
  };
}
