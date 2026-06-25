import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  try {
    await initDb();

    const { searchParams } = new URL(request.url);
    const fid = Number(searchParams.get("fid"));
    const limit = Math.min(
      MAX_LIMIT,
      Number(searchParams.get("limit")) || DEFAULT_LIMIT,
    );
    const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

    if (!Number.isSafeInteger(fid)) {
      return NextResponse.json(
        { success: false, error: "A valid fid is required" },
        { status: 400 },
      );
    }

    const { rows } = await db.execute({
      sql: `SELECT id, table_id, hole_cards, board, result, net_amount, pot_size, phase_reached, resolution, created_at
            FROM hand_history WHERE fid = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [fid, limit, offset],
    });

    return NextResponse.json({
      success: true,
      hands: rows.map((row: any) => ({
        id: Number(row.id),
        tableId: String(row.table_id),
        holeCards: String(row.hole_cards || "").split(",").filter(Boolean),
        board: String(row.board || "").split(",").filter(Boolean),
        result: String(row.result),
        netAmount: Number(row.net_amount || 0),
        potSize: Number(row.pot_size || 0),
        phaseReached: String(row.phase_reached || ""),
        resolution: String(row.resolution || ""),
        createdAt: String(row.created_at),
      })),
    });
  } catch (error) {
    console.error("Hand history stats error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load hand history" },
      { status: 500 },
    );
  }
}
