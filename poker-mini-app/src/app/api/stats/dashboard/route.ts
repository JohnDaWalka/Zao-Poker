import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

export async function GET(request: Request) {
  try {
    await initDb();

    const { searchParams } = new URL(request.url);
    const fid = Number(searchParams.get("fid"));

    if (!Number.isSafeInteger(fid)) {
      return NextResponse.json(
        { success: false, error: "A valid fid is required" },
        { status: 400 },
      );
    }

    const { rows: statsRows } = await db.execute({
      sql: "SELECT * FROM player_stats WHERE fid = ?",
      args: [fid],
    });
    const stats = statsRows[0];

    const { rows: recentRows } = await db.execute({
      sql: "SELECT net_amount, created_at FROM hand_history WHERE fid = ? ORDER BY created_at DESC LIMIT 30",
      args: [fid],
    });

    // Oldest-first running balance, for a sparkline of the last ~30 hands.
    const recentTrend = recentRows
      .slice()
      .reverse()
      .map((row: any) => Number(row.net_amount || 0));

    const handsPlayed = Number(stats?.hands_played || 0);
    const handsWon = Number(stats?.hands_won || 0);

    return NextResponse.json({
      success: true,
      dashboard: {
        netWinnings: Number(stats?.net_winnings || 0),
        handsPlayed,
        handsWon,
        winRate: handsPlayed > 0 ? handsWon / handsPlayed : 0,
        biggestPotWon: Number(stats?.biggest_pot_won || 0),
        currentStreak: Number(stats?.current_streak || 0),
        bestStreak: Number(stats?.best_streak || 0),
        recentTrend,
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load dashboard stats" },
      { status: 500 },
    );
  }
}
