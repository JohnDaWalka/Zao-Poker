import { NextResponse } from "next/server";
import { db, initDb } from "~/lib/db";

function createClubId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return `club_${slug || "home-game"}_${Date.now().toString(36)}`;
}

function createInviteCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

function canManageClub(role: string) {
  return role === "owner" || role === "admin";
}

function normalizeRole(role: unknown) {
  return String(role || "member");
}

function mapClubSummary(row: any) {
  return {
    id: String(row.id),
    name: String(row.name),
    inviteCode: String(row.invite_code),
    role: normalizeRole(row.role),
    memberCount: Number(row.member_count || 0),
    createdAt: String(row.created_at),
  };
}

async function loadClubSummaries(fid: number) {
  const { rows } = await db.execute({
    sql: `
      SELECT
        c.id,
        c.name,
        c.invite_code,
        c.created_at,
        cm.role,
        (
          SELECT COUNT(*)
          FROM club_memberships membership_count
          WHERE membership_count.club_id = c.id
        ) AS member_count
      FROM clubs c
      JOIN club_memberships cm
        ON cm.club_id = c.id
      WHERE cm.fid = ?
      ORDER BY c.created_at DESC
    `,
    args: [fid],
  });

  return rows.map(mapClubSummary);
}

async function loadViewerMembership(clubId: string, fid: number) {
  const { rows } = await db.execute({
    sql: `
      SELECT c.id, c.name, c.invite_code, c.created_at, cm.role
      FROM clubs c
      JOIN club_memberships cm
        ON cm.club_id = c.id
      WHERE c.id = ? AND cm.fid = ?
      LIMIT 1
    `,
    args: [clubId, fid],
  });

  return rows[0] ?? null;
}

async function loadClubDetail(clubId: string, fid: number) {
  const membership = await loadViewerMembership(clubId, fid);
  if (!membership) {
    return null;
  }

  const role = normalizeRole(membership.role);
  const isAdmin = canManageClub(role);

  const { rows: memberRows } = await db.execute({
    sql: `
      SELECT club_id, fid, username, pfp_url, role, joined_at
      FROM club_memberships
      WHERE club_id = ?
      ORDER BY
        CASE role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          ELSE 2
        END,
        joined_at ASC,
        fid ASC
    `,
    args: [clubId],
  });

  const { rows: tableRows } = await db.execute({
    sql: `
      SELECT
        t.id,
        t.name,
        t.status,
        t.game_type,
        t.stakes_label,
        t.max_players,
        t.created_at,
        (
          SELECT COUNT(*)
          FROM players p
          WHERE p.table_id = t.id
        ) AS player_count
      FROM tables t
      WHERE t.club_id = ?
      ORDER BY COALESCE(t.created_at, t.updated_at) DESC, t.id DESC
      LIMIT 12
    `,
    args: [clubId],
  });

  const reports = isAdmin
    ? (
        await db.execute({
          sql: `
            SELECT
              r.id,
              r.message_id,
              r.reporter_fid,
              r.reported_fid,
              r.reason,
              r.status,
              r.created_at,
              r.reviewed_at,
              r.reviewed_by_fid,
              r.resolution_note,
              t.id AS table_id,
              t.name AS table_name,
              reporter.username AS reporter_username,
              reported.username AS reported_username,
              m.message AS message_text
            FROM table_chat_reports r
            JOIN tables t
              ON t.id = r.table_id
            LEFT JOIN club_memberships reporter
              ON reporter.club_id = t.club_id AND reporter.fid = r.reporter_fid
            LEFT JOIN club_memberships reported
              ON reported.club_id = t.club_id AND reported.fid = r.reported_fid
            LEFT JOIN table_chat_messages m
              ON m.id = r.message_id
            WHERE t.club_id = ?
            ORDER BY
              CASE r.status
                WHEN 'open' THEN 0
                ELSE 1
              END,
              r.created_at DESC,
              r.id DESC
            LIMIT 25
          `,
          args: [clubId],
        })
      ).rows.map((row: any) => ({
        id: Number(row.id),
        messageId: Number(row.message_id),
        tableId: String(row.table_id),
        tableName: String(row.table_name || "Club Table"),
        reporterFid: Number(row.reporter_fid),
        reporterName: String(row.reporter_username || `User#${row.reporter_fid}`),
        reportedFid: Number(row.reported_fid),
        reportedName: String(row.reported_username || `User#${row.reported_fid}`),
        message: String(row.message_text || ""),
        reason: String(row.reason || "table_chat_report"),
        status: String(row.status || "open"),
        createdAt: String(row.created_at),
        reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
        reviewedByFid: Number.isSafeInteger(Number(row.reviewed_by_fid))
          ? Number(row.reviewed_by_fid)
          : null,
        resolutionNote: String(row.resolution_note || ""),
      }))
    : [];

  return {
    ...mapClubSummary({
      ...membership,
      member_count: memberRows.length,
    }),
    isAdmin,
    members: memberRows.map((row: any) => ({
      fid: Number(row.fid),
      username: String(row.username || `User#${row.fid}`),
      pfpUrl: String(row.pfp_url || ""),
      role: normalizeRole(row.role),
      joinedAt: String(row.joined_at),
    })),
    tables: tableRows.map((row: any) => ({
      id: String(row.id),
      name: String(row.name || "Club Table"),
      status: String(row.status || "waiting"),
      game: String(row.game_type || "NLHE"),
      stakes: String(row.stakes_label || "$0.50 / $1"),
      maxPlayers: Number(row.max_players || 6),
      playerCount: Number(row.player_count || 0),
      createdAt: String(row.created_at || ""),
    })),
    reports,
  };
}

async function updateInviteCode(clubId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = createInviteCode();
    try {
      await db.execute({
        sql: "UPDATE clubs SET invite_code = ? WHERE id = ?",
        args: [inviteCode, clubId],
      });
      return inviteCode;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
    }
  }

  throw new Error("Unable to generate invite code");
}

export async function GET(request: Request) {
  try {
    await initDb();

    const { searchParams } = new URL(request.url);
    const fid = Number(searchParams.get("fid"));
    const clubId = String(searchParams.get("club_id") || "").trim();

    if (!Number.isSafeInteger(fid)) {
      return NextResponse.json(
        { success: false, error: "A valid fid is required" },
        { status: 400 },
      );
    }

    const clubs = await loadClubSummaries(fid);

    if (!clubId) {
      return NextResponse.json({
        success: true,
        clubs,
      });
    }

    const clubDetail = await loadClubDetail(clubId, fid);
    if (!clubDetail) {
      return NextResponse.json(
        { success: false, error: "This club is only available to current members" },
        { status: 403 },
      );
    }

    return NextResponse.json({
      success: true,
      clubs,
      clubDetail,
    });
  } catch (error) {
    console.error("Clubs GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load clubs" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await initDb();

    const payload = await request.json();
    const action = String(payload.action || "").trim();
    const fid = Number(payload.fid);
    const username =
      typeof payload.username === "string" && payload.username.trim()
        ? payload.username.trim()
        : `User#${fid}`;
    const pfpUrl = typeof payload.pfp_url === "string" ? payload.pfp_url : "";

    if (!Number.isSafeInteger(fid)) {
      return NextResponse.json(
        { success: false, error: "A valid fid is required" },
        { status: 400 },
      );
    }

    if (action === "create") {
      const clubName =
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name.trim()
          : "";

      if (clubName.length < 3) {
        return NextResponse.json(
          { success: false, error: "Club name must be at least 3 characters" },
          { status: 400 },
        );
      }

      if (clubName.length > 48) {
        return NextResponse.json(
          { success: false, error: "Club name must be 48 characters or fewer" },
          { status: 400 },
        );
      }

      const clubId = createClubId(clubName);
      let inviteCode = "";

      for (let attempt = 0; attempt < 5; attempt += 1) {
        inviteCode = createInviteCode();
        try {
          await db.execute({
            sql: `
              INSERT INTO clubs (id, name, invite_code, created_by_fid)
              VALUES (?, ?, ?, ?)
            `,
            args: [clubId, clubName, inviteCode, fid],
          });
          break;
        } catch (error) {
          if (attempt === 4) {
            throw error;
          }
        }
      }

      await db.execute({
        sql: `
          INSERT OR REPLACE INTO club_memberships (club_id, fid, username, pfp_url, role)
          VALUES (?, ?, ?, ?, 'owner')
        `,
        args: [clubId, fid, username, pfpUrl],
      });

      const clubs = await loadClubSummaries(fid);
      const createdClub = clubs.find((club) => club.id === clubId);

      return NextResponse.json({
        success: true,
        club: createdClub,
        clubs,
        clubDetail: await loadClubDetail(clubId, fid),
      });
    }

    if (action === "join") {
      const inviteCode =
        typeof payload.inviteCode === "string" && payload.inviteCode.trim()
          ? payload.inviteCode.trim().toUpperCase()
          : "";

      if (!inviteCode) {
        return NextResponse.json(
          { success: false, error: "An invite code is required" },
          { status: 400 },
        );
      }

      const { rows: clubRows } = await db.execute({
        sql: "SELECT id, name FROM clubs WHERE invite_code = ?",
        args: [inviteCode],
      });
      const club = clubRows[0];

      if (!club) {
        return NextResponse.json(
          { success: false, error: "Invite code not found" },
          { status: 404 },
        );
      }

      await db.execute({
        sql: `
          INSERT OR IGNORE INTO club_memberships (club_id, fid, username, pfp_url, role)
          VALUES (?, ?, ?, ?, 'member')
        `,
        args: [String(club.id), fid, username, pfpUrl],
      });

      await db.execute({
        sql: `
          UPDATE club_memberships
          SET username = ?, pfp_url = ?
          WHERE club_id = ? AND fid = ?
        `,
        args: [username, pfpUrl, String(club.id), fid],
      });

      const clubs = await loadClubSummaries(fid);
      const joinedClub = clubs.find((entry) => entry.id === String(club.id));

      return NextResponse.json({
        success: true,
        club: joinedClub,
        clubs,
        clubDetail: await loadClubDetail(String(club.id), fid),
      });
    }

    const clubId =
      typeof payload.club_id === "string" && payload.club_id.trim()
        ? payload.club_id.trim()
        : typeof payload.clubId === "string" && payload.clubId.trim()
          ? payload.clubId.trim()
          : "";

    if (!clubId) {
      return NextResponse.json(
        { success: false, error: "A valid club is required" },
        { status: 400 },
      );
    }

    const membership = await loadViewerMembership(clubId, fid);
    if (!membership) {
      return NextResponse.json(
        { success: false, error: "This club is only available to current members" },
        { status: 403 },
      );
    }

    const viewerRole = normalizeRole(membership.role);
    const isAdmin = canManageClub(viewerRole);

    if (action === "regenerate_invite") {
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: "Only club owners or admins can rotate invite codes" },
          { status: 403 },
        );
      }

      await updateInviteCode(clubId);

      return NextResponse.json({
        success: true,
        clubs: await loadClubSummaries(fid),
        clubDetail: await loadClubDetail(clubId, fid),
      });
    }

    if (action === "remove_member") {
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: "Only club owners or admins can remove members" },
          { status: 403 },
        );
      }

      const targetFid = Number(payload.targetFid ?? payload.target_fid);
      if (!Number.isSafeInteger(targetFid) || targetFid === fid) {
        return NextResponse.json(
          { success: false, error: "Choose a different member to remove from the club" },
          { status: 400 },
        );
      }

      const { rows: targetRows } = await db.execute({
        sql: `
          SELECT role
          FROM club_memberships
          WHERE club_id = ? AND fid = ?
          LIMIT 1
        `,
        args: [clubId, targetFid],
      });
      const targetMembership = targetRows[0];

      if (!targetMembership) {
        return NextResponse.json(
          { success: false, error: "Club member not found" },
          { status: 404 },
        );
      }

      if (normalizeRole(targetMembership.role) === "owner") {
        return NextResponse.json(
          { success: false, error: "The club owner cannot be removed from the roster" },
          { status: 400 },
        );
      }

      await db.execute({
        sql: "DELETE FROM club_memberships WHERE club_id = ? AND fid = ?",
        args: [clubId, targetFid],
      });

      await db.execute({
        sql: `
          DELETE FROM players
          WHERE fid = ?
            AND table_id IN (
              SELECT id
              FROM tables
              WHERE club_id = ? AND status != 'playing'
            )
        `,
        args: [targetFid, clubId],
      });

      return NextResponse.json({
        success: true,
        clubs: await loadClubSummaries(fid),
        clubDetail: await loadClubDetail(clubId, fid),
      });
    }

    if (action === "resolve_report" || action === "dismiss_report") {
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: "Only club owners or admins can review reports" },
          { status: 403 },
        );
      }

      const reportId = Number(payload.reportId ?? payload.report_id);
      if (!Number.isSafeInteger(reportId)) {
        return NextResponse.json(
          { success: false, error: "A valid report is required" },
          { status: 400 },
        );
      }

      const { rows: reportRows } = await db.execute({
        sql: `
          SELECT r.id
          FROM table_chat_reports r
          JOIN tables t
            ON t.id = r.table_id
          WHERE r.id = ? AND t.club_id = ?
          LIMIT 1
        `,
        args: [reportId, clubId],
      });

      if (reportRows.length === 0) {
        return NextResponse.json(
          { success: false, error: "Club report not found" },
          { status: 404 },
        );
      }

      const nextStatus = action === "resolve_report" ? "resolved" : "dismissed";
      const resolutionNote =
        typeof payload.resolutionNote === "string"
          ? payload.resolutionNote.trim().slice(0, 160)
          : typeof payload.resolution_note === "string"
            ? payload.resolution_note.trim().slice(0, 160)
            : "";

      await db.execute({
        sql: `
          UPDATE table_chat_reports
          SET status = ?, reviewed_by_fid = ?, reviewed_at = CURRENT_TIMESTAMP, resolution_note = ?
          WHERE id = ?
        `,
        args: [nextStatus, fid, resolutionNote, reportId],
      });

      return NextResponse.json({
        success: true,
        clubs: await loadClubSummaries(fid),
        clubDetail: await loadClubDetail(clubId, fid),
      });
    }

    return NextResponse.json(
      { success: false, error: "Unsupported club action" },
      { status: 400 },
    );
  } catch (error) {
    console.error("Clubs POST error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update clubs" },
      { status: 500 },
    );
  }
}
