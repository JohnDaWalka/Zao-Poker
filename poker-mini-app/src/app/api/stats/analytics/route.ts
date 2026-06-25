import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

export async function GET(request: Request) {
  try {
    await initDb();

    const { searchParams } = new URL(request.url);
    const fid = Number(searchParams.get("fid"));
    const days = Math.min(90, Number(searchParams.get("days")) || 14);

    if (!Number.isSafeInteger(fid)) {
      return NextResponse.json(
        { success: false, error: "A valid fid is required" },
        { status: 400 },
      );
    }

    const { rows: dailyRows } = await db.execute({
      sql: `SELECT
              strftime('%Y-%m-%d', created_at) as day,
              SUM(net_amount) as net,
              COUNT(*) as hands,
              SUM(CASE WHEN result != 'loss' THEN 1 ELSE 0 END) as wins
            FROM hand_history
            WHERE fid = ? AND created_at >= datetime('now', ?)
            GROUP BY day
            ORDER BY day ASC`,
      args: [fid, `-${days} days`],
    });

    const series = dailyRows.map((row: any) => ({
      day: String(row.day),
      net: Number(row.net || 0),
      hands: Number(row.hands || 0),
      winRate: Number(row.hands) > 0 ? Number(row.wins) / Number(row.hands) : 0,
    }));

    const { rows: totalsRows } = await db.execute({
      sql: `SELECT
              COUNT(*) as hands,
              SUM(CASE WHEN result != 'loss' THEN 1 ELSE 0 END) as wins,
              SUM(net_amount) as net,
              AVG(pot_size) as avg_pot,
              MAX(net_amount) as biggest_win
            FROM hand_history WHERE fid = ? AND created_at >= datetime('now', ?)`,
      args: [fid, `-${days} days`],
    });
    const totals = totalsRows[0];
    const hands = Number(totals?.hands || 0);
    const wins = Number(totals?.wins || 0);

    return NextResponse.json({
      success: true,
      analytics: {
        rangeDays: days,
        series,
        hands,
        winRate: hands > 0 ? wins / hands : 0,
        netAmount: Number(totals?.net || 0),
        netPer100Hands: hands > 0 ? (Number(totals?.net || 0) / hands) * 100 : 0,
        avgPotSize: Number(totals?.avg_pot || 0),
        biggestWin: Number(totals?.biggest_win || 0),
      },
    });
  } catch (error) {
    console.error("Analytics stats error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load analytics" },
      { status: 500 },
    );
  }
}
