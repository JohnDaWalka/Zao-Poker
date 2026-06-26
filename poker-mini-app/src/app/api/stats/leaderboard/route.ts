import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const EXCLUDED_FIDS = [1, 900001, 900002];
const EXCLUDED_FID_SQL = EXCLUDED_FIDS.map(() => "?").join(", ");

export async function GET(request: Request) {
  try {
    await initDb();

    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      MAX_LIMIT,
      Number(searchParams.get("limit")) || DEFAULT_LIMIT,
    );
    const focusFid = Number(searchParams.get("fid"));

    const { rows } = await db.execute({
      sql: `SELECT fid, username, pfp_url, hands_played, hands_won, net_winnings, best_streak
            FROM player_stats WHERE fid NOT IN (${EXCLUDED_FID_SQL}) AND hands_played > 0
            ORDER BY net_winnings DESC LIMIT ?`,
      args: [...EXCLUDED_FIDS, limit],
    });

    const leaderboard = rows.map((row: any, index: number) => ({
      rank: index + 1,
      fid: Number(row.fid),
      username: String(row.username || `User#${row.fid}`),
      pfpUrl: String(row.pfp_url || ""),
      handsPlayed: Number(row.hands_played || 0),
      handsWon: Number(row.hands_won || 0),
      netWinnings: Number(row.net_winnings || 0),
      bestStreak: Number(row.best_streak || 0),
    }));

    let viewerRank: number | null = null;
    if (Number.isSafeInteger(focusFid) && !leaderboard.some((p) => p.fid === focusFid)) {
      const { rows: focusRows } = await db.execute({
        sql: `SELECT net_winnings FROM player_stats
              WHERE fid = ? AND fid NOT IN (${EXCLUDED_FID_SQL}) AND hands_played > 0`,
        args: [focusFid, ...EXCLUDED_FIDS],
      });

      if (focusRows.length > 0) {
        const focusNetWinnings = Number(focusRows[0]?.net_winnings || 0);
        const { rows: rankRows } = await db.execute({
          sql: `SELECT COUNT(*) as ahead FROM player_stats
                WHERE fid NOT IN (${EXCLUDED_FID_SQL}) AND hands_played > 0 AND net_winnings > ?`,
          args: [...EXCLUDED_FIDS, focusNetWinnings],
        });
        const ahead = Number(rankRows[0]?.ahead ?? -1);
        if (ahead >= 0) viewerRank = ahead + 1;
      }
    }

    return NextResponse.json({ success: true, leaderboard, viewerRank });
  } catch (error) {
    console.error("Leaderboard stats error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load leaderboard" },
      { status: 500 },
    );
  }
}
