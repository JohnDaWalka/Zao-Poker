import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

let dbReady: Promise<void> | null = null;

function ensureDb() {
  if (!dbReady) {
    dbReady = initDb().catch((error) => {
      dbReady = null;
      throw error;
    });
  }
  return dbReady;
}

export async function POST(request: Request) {
  await ensureDb();
  const body = await request.json();
  const { fid, hand_id, analysis, tags, confidence, variant, pot_size } = body;

  if (!fid || !hand_id) {
    return NextResponse.json({ success: false, error: "fid and hand_id required" }, { status: 400 });
  }

  try {
    await db.execute({
      sql: `
        INSERT INTO dossier_entries (
          fid, hand_id, analysis, tags, confidence, variant, pot_size, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(fid, hand_id) DO UPDATE SET
          analysis = excluded.analysis,
          tags = excluded.tags,
          confidence = excluded.confidence,
          variant = excluded.variant,
          pot_size = excluded.pot_size,
          created_at = CURRENT_TIMESTAMP
      `,
      args: [
        fid,
        hand_id,
        analysis || "",
        Array.isArray(tags) ? tags.join(",") : "",
        confidence ?? 0,
        variant || "",
        pot_size ?? 0,
      ],
    });

    return NextResponse.json({ success: true, hand_id });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  await ensureDb();
  const { searchParams } = new URL(request.url);
  const fid = searchParams.get("fid");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  if (!fid) {
    return NextResponse.json({ success: false, error: "fid required" }, { status: 400 });
  }

  try {
    const { rows } = await db.execute({
      sql: "SELECT * FROM dossier_entries WHERE fid = ? ORDER BY created_at DESC LIMIT ?",
      args: [fid, limit],
    });

    return NextResponse.json({
      success: true,
      entries: rows.map((r) => ({
        hand_id: r.hand_id,
        analysis: r.analysis,
        tags: String(r.tags || "").split(",").filter(Boolean),
        confidence: Number(r.confidence || 0),
        variant: r.variant,
        pot_size: Number(r.pot_size || 0),
        created_at: r.created_at,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
