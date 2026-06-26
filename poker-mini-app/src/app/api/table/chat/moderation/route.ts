import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

async function isSeatedAtTable(tableId: string, fid: number) {
  const { rows } = await db.execute({
    sql: "SELECT fid FROM players WHERE table_id = ? AND fid = ? LIMIT 1",
    args: [tableId, fid],
  });
  return rows.length > 0;
}

async function loadMutedFids(fid: number) {
  const { rows } = await db.execute({
    sql: "SELECT muted_fid FROM user_chat_mutes WHERE fid = ? ORDER BY created_at DESC",
    args: [fid],
  });
  return rows.map((row: any) => Number(row.muted_fid)).filter(Number.isSafeInteger);
}

export async function POST(request: Request) {
  try {
    await initDb();

    const payload = await request.json();
    const action = String(payload.action || "").trim();
    const tableId = String(payload.table_id || "").trim();
    const fid = Number(payload.fid);
    const targetFid = Number(payload.target_fid);
    const messageId = Number(payload.message_id);
    const reason =
      typeof payload.reason === "string" && payload.reason.trim()
        ? payload.reason.trim().slice(0, 140)
        : "table_chat_report";

    if (!tableId) {
      return NextResponse.json(
        { success: false, error: "A valid table_id is required" },
        { status: 400 },
      );
    }

    if (!Number.isSafeInteger(fid)) {
      return NextResponse.json(
        { success: false, error: "A valid player fid is required" },
        { status: 400 },
      );
    }

    const { rows: tableRows } = await db.execute({
      sql: "SELECT id FROM tables WHERE id = ?",
      args: [tableId],
    });

    if (tableRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Table not found" },
        { status: 404 },
      );
    }

    if (!(await isSeatedAtTable(tableId, fid))) {
      return NextResponse.json(
        { success: false, error: "You must be seated at this table to moderate chat" },
        { status: 403 },
      );
    }

    if (action === "mute") {
      if (!Number.isSafeInteger(targetFid) || targetFid === fid) {
        return NextResponse.json(
          { success: false, error: "A different player is required to mute chat" },
          { status: 400 },
        );
      }

      await db.execute({
        sql: `
          INSERT OR IGNORE INTO user_chat_mutes (fid, muted_fid)
          VALUES (?, ?)
        `,
        args: [fid, targetFid],
      });

      return NextResponse.json({
        success: true,
        mutedFids: await loadMutedFids(fid),
      });
    }

    if (action === "unmute") {
      if (!Number.isSafeInteger(targetFid) || targetFid === fid) {
        return NextResponse.json(
          { success: false, error: "A different player is required to unmute chat" },
          { status: 400 },
        );
      }

      await db.execute({
        sql: "DELETE FROM user_chat_mutes WHERE fid = ? AND muted_fid = ?",
        args: [fid, targetFid],
      });

      return NextResponse.json({
        success: true,
        mutedFids: await loadMutedFids(fid),
      });
    }

    if (action === "report") {
      if (!Number.isSafeInteger(targetFid) || targetFid === fid) {
        return NextResponse.json(
          { success: false, error: "A different player is required to report chat" },
          { status: 400 },
        );
      }

      if (!Number.isSafeInteger(messageId)) {
        return NextResponse.json(
          { success: false, error: "A valid message is required to file a report" },
          { status: 400 },
        );
      }

      const { rows: messageRows } = await db.execute({
        sql: `
          SELECT id, fid
          FROM table_chat_messages
          WHERE id = ? AND table_id = ?
          LIMIT 1
        `,
        args: [messageId, tableId],
      });
      const message = messageRows[0];

      if (!message || Number(message.fid) !== targetFid) {
        return NextResponse.json(
          { success: false, error: "Chat message not found for report" },
          { status: 404 },
        );
      }

      await db.execute({
        sql: `
          INSERT INTO table_chat_reports (table_id, message_id, reporter_fid, reported_fid, reason)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [tableId, messageId, fid, targetFid, reason],
      });

      return NextResponse.json({
        success: true,
      });
    }

    return NextResponse.json(
      { success: false, error: "Unsupported moderation action" },
      { status: 400 },
    );
  } catch (error) {
    console.error("Table chat moderation POST error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update chat moderation" },
      { status: 500 },
    );
  }
}
