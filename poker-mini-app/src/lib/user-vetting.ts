// ---------------------------------------------------------------------------
// Neynar User Score / Reputation Vetting
// ---------------------------------------------------------------------------
// Neynar assigns every Farcaster account a quality score between 0 and 1.0.
// Default for new users: 0.5. Recommended app threshold: ~0.55.
// This module provides utilities to gate app features based on user reputation.
//
// References:
// - https://docs.neynar.com/docs/neynar-user-quality-score
// - https://neynar.com/blog/neynar-scores-under-the-hood
// ---------------------------------------------------------------------------

export interface UserVettingResult {
  fid: number;
  username: string;
  score: number;
  powerBadge: boolean;
  followerCount: number;
  isVetted: boolean;
  tier: "unrated" | "low" | "standard" | "high" | "elite";
  checks: {
    scoreCheck: boolean;
    powerBadgeCheck: boolean;
    followerCheck: boolean;
  };
}

export interface VettingThresholds {
  minScore: number;
  requirePowerBadge: boolean;
  minFollowers: number;
}

export const DEFAULT_THRESHOLDS: VettingThresholds = {
  minScore: 0.55,        // Neynar recommended starting threshold
  requirePowerBadge: false,
  minFollowers: 0,
};

export const STRICT_THRESHOLDS: VettingThresholds = {
  minScore: 0.70,
  requirePowerBadge: false,
  minFollowers: 50,
};

export const ELITE_THRESHOLDS: VettingThresholds = {
  minScore: 0.85,
  requirePowerBadge: true,
  minFollowers: 500,
};

function getScoreTier(score: number): UserVettingResult["tier"] {
  if (score >= 0.85) return "elite";
  if (score >= 0.70) return "high";
  if (score >= 0.55) return "standard";
  if (score >= 0.30) return "low";
  return "unrated";
}

export function vetUser(
  user: {
    fid: number;
    username: string;
    score?: number;
    powerBadge?: boolean;
    followerCount?: number;
  },
  thresholds: VettingThresholds = DEFAULT_THRESHOLDS
): UserVettingResult {
  const score = user.score ?? 0.5;
  const powerBadge = user.powerBadge ?? false;
  const followerCount = user.followerCount ?? 0;

  const scoreCheck = score >= thresholds.minScore;
  const powerBadgeCheck = !thresholds.requirePowerBadge || powerBadge;
  const followerCheck = followerCount >= thresholds.minFollowers;

  const isVetted = scoreCheck && powerBadgeCheck && followerCheck;

  return {
    fid: user.fid,
    username: user.username,
    score,
    powerBadge,
    followerCount,
    isVetted,
    tier: getScoreTier(score),
    checks: {
      scoreCheck,
      powerBadgeCheck,
      followerCheck,
    },
  };
}

export async function fetchUserScore(fid: number): Promise<number | null> {
  try {
    const res = await fetch(`/api/users/score?fids=${fid}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.users?.[0]?.score ?? null;
  } catch (e) {
    console.error("Failed to fetch user score:", e);
    return null;
  }
}

export async function vetUserByFid(
  fid: number,
  thresholds: VettingThresholds = DEFAULT_THRESHOLDS
): Promise<UserVettingResult | null> {
  try {
    const res = await fetch(`/api/users/score?fids=${fid}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const user = data.users?.[0];
    if (!user) return null;

    return vetUser(
      {
        fid: user.fid,
        username: user.username,
        score: user.score,
        powerBadge: user.power_badge,
        followerCount: user.follower_count,
      },
      thresholds
    );
  } catch (e) {
    console.error("Failed to vet user:", e);
    return null;
  }
}

// Pre-computed tier colors for UI
export const TIER_COLORS: Record<UserVettingResult["tier"], string> = {
  unrated: "text-gray-400",
  low: "text-red-400",
  standard: "text-yellow-400",
  high: "text-green-400",
  elite: "text-purple-400",
};

export const TIER_LABELS: Record<UserVettingResult["tier"], string> = {
  unrated: "Unrated",
  low: "Low Quality",
  standard: "Standard",
  high: "High Quality",
  elite: "Elite",
};

export const TIER_DESCRIPTIONS: Record<UserVettingResult["tier"], string> = {
  unrated: "New or inactive account. Score defaults to 0.5.",
  low: "Below standard quality threshold. May be restricted.",
  standard: "Meets minimum quality requirements. Recommended threshold.",
  high: "Above-average quality. Good network participant.",
  elite: "Top-tier quality. Power user or verified.",
};
