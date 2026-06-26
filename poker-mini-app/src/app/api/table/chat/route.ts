import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 280;

function mapMessage(row: any) {
  return {
    id: Number(row.id),
    tableId: String(row.table_id),
    fid: Number(row.fid),
    username: String(row.username || `User#${row.fid}`),
    pfpUrl: row.pfp_url ? String(row.pfp_url) : "",
    isBot: Number(row.is_bot || 0) === 1,
    message: String(row.message || ""),
    createdAt: String(row.created_at),
  };
}

export async function GET(request: Request) {
  try {
    await initDb();

    const { searchParams } = new URL(request.url);
    const tableId = String(searchParams.get("table_id") || "").trim();
    const fid = Number(searchParams.get("fid"));
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(searchParams.get("limit")) || DEFAULT_LIMIT),
    );

    if (!tableId) {
      return NextResponse.json(
        { success: false, error: "A valid table_id is required" },
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

    const { rows } = await db.execute({
      sql: `
        SELECT id, table_id, fid, username, pfp_url, is_bot, message, created_at
        FROM table_chat_messages
        WHERE table_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      args: [tableId, limit],
    });

    const mutedFids = Number.isSafeInteger(fid)
      ? (
          await db.execute({
            sql: "SELECT muted_fid FROM user_chat_mutes WHERE fid = ?",
            args: [fid],
          })
        ).rows.map((row: any) => Number(row.muted_fid)).filter(Number.isSafeInteger)
      : [];

    return NextResponse.json({
      success: true,
      messages: rows.slice().reverse().map(mapMessage),
      mutedFids,
    });
  } catch (error) {
    console.error("Table chat GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load table chat" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await initDb();

    const payload = await request.json();
    const tableId = String(payload.table_id || "").trim();
    const fid = Number(payload.fid);
    const message = String(payload.message || "").trim();

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

    if (!message) {
      return NextResponse.json(
        { success: false, error: "Message cannot be empty" },
        { status: 400 },
      );
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` },
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

    const { rows: playerRows } = await db.execute({
      sql: "SELECT fid, username, pfp_url, is_bot FROM players WHERE table_id = ? AND fid = ?",
      args: [tableId, fid],
    });
    const player = playerRows[0];

    if (!player) {
      return NextResponse.json(
        { success: false, error: "You must be seated at this table to chat" },
        { status: 403 },
      );
    }

    await db.execute({
      sql: `
        INSERT INTO table_chat_messages (table_id, fid, username, pfp_url, is_bot, message)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        tableId,
        fid,
        String(player.username || `User#${fid}`),
        String(player.pfp_url || ""),
        Number(player.is_bot || 0),
        message,
      ],
    });

    const { rows: insertedRows } = await db.execute({
      sql: `
        SELECT id, table_id, fid, username, pfp_url, is_bot, message, created_at
        FROM table_chat_messages
        WHERE table_id = ? AND fid = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      args: [tableId, fid],
    });

    return NextResponse.json({
      success: true,
      message: mapMessage(insertedRows[0]),
    });
  } catch (error) {
    console.error("Table chat POST error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to send table chat message" },
      { status: 500 },
    );
  }
}
