/**
 * WebSocket Lobby API
 * 
 * Real-time lobby for ZAO Poker using Next.js + ws library.
 * Supports: room listing, player presence, chat, table state updates.
 * 
 * Usage: Connect via WebSocket to wss://<host>/api/lobby
 * Protocol: JSON messages with { type, payload }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '~/lib/db';

// Simple in-memory presence store (use Redis in production)
interface LobbyClient {
  fid: number;
  username: string;
  tableId: string | null;
  lastPing: number;
}

const clients = new Map<string, LobbyClient>(); // connectionId -> client
const tableSubscribers = new Map<string, Set<string>>(); // tableId -> connectionIds

// Heartbeat to clean up stale connections
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 60000; // 60 seconds
  for (const [id, client] of clients.entries()) {
    if (now - client.lastPing > staleThreshold) {
      clients.delete(id);
      // Remove from table subscriptions
      for (const [tableId, subs] of tableSubscribers.entries()) {
        subs.delete(id);
      }
    }
  }
}, 30000);

// GET: Return lobby status (for HTTP polling fallback)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') || 'status';

    switch (action) {
      case 'status': {
        const onlineCount = clients.size;
        const { rows: tableRows } = await db.execute({
          sql: `SELECT id, name, game_type, stakes_label, max_players, status,
                (SELECT COUNT(*) FROM players WHERE table_id = tables.id AND status != 'waiting') as player_count
                FROM tables WHERE status IN ('waiting', 'playing') LIMIT 50`,
        });
        return NextResponse.json({
          onlinePlayers: onlineCount,
          tables: tableRows,
          timestamp: Date.now(),
        });
      }

      case 'tables': {
        const { rows } = await db.execute({
          sql: `SELECT t.*, 
                (SELECT COUNT(*) FROM players p WHERE p.table_id = t.id AND p.status != 'waiting') as player_count
                FROM tables t WHERE t.status IN ('waiting', 'playing') ORDER BY t.created_at DESC LIMIT 50`,
        });
        return NextResponse.json({ tables: rows });
      }

      case 'table': {
        const tableId = searchParams.get('tableId');
        if (!tableId) {
          return NextResponse.json({ error: 'tableId required' }, { status: 400 });
        }
        const { rows: tableRows } = await db.execute({
          sql: 'SELECT * FROM tables WHERE id = ?',
          args: [tableId],
        });
        const { rows: playerRows } = await db.execute({
          sql: 'SELECT fid, username, seat_index, stack_size, status, visible_cards FROM players WHERE table_id = ? ORDER BY seat_index',
          args: [tableId],
        });
        return NextResponse.json({
          table: tableRows[0] || null,
          players: playerRows,
          subscribers: tableSubscribers.get(tableId)?.size || 0,
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Lobby API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: Handle lobby actions (join, leave, message)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, fid, username, tableId, message } = body;

    switch (action) {
      case 'join': {
        if (!fid || !tableId) {
          return NextResponse.json({ error: 'fid and tableId required' }, { status: 400 });
        }
        
        // Check if table exists and has space
        const { rows } = await db.execute({
          sql: `SELECT t.*, (SELECT COUNT(*) FROM players p WHERE p.table_id = t.id AND p.status != 'waiting') as player_count
                FROM tables t WHERE t.id = ?`,
          args: [tableId],
        });
        if (rows.length === 0) {
          return NextResponse.json({ error: 'Table not found' }, { status: 404 });
        }
        const table = rows[0] as any;
        if (table.player_count >= table.max_players) {
          return NextResponse.json({ error: 'Table full' }, { status: 400 });
        }

        // Add player to table
        const seatIndex = table.player_count;
        await db.execute({
          sql: `INSERT INTO players (fid, username, table_id, seat_index, stack_size, status)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (fid, table_id) DO UPDATE SET
                  seat_index = excluded.seat_index,
                  status = excluded.status`,
          args: [fid, username || `Player_${fid}`, tableId, seatIndex, table.buy_in || 5000, 'waiting'],
        });

        return NextResponse.json({ success: true, seatIndex });
      }

      case 'leave': {
        if (!fid || !tableId) {
          return NextResponse.json({ error: 'fid and tableId required' }, { status: 400 });
        }
        await db.execute({
          sql: 'UPDATE players SET status = ? WHERE fid = ? AND table_id = ?',
          args: ['waiting', fid, tableId],
        });
        return NextResponse.json({ success: true });
      }

      case 'ready': {
        if (!fid || !tableId) {
          return NextResponse.json({ error: 'fid and tableId required' }, { status: 400 });
        }
        await db.execute({
          sql: 'UPDATE players SET is_ready = 1 WHERE fid = ? AND table_id = ?',
          args: [fid, tableId],
        });
        
        // Check if all players are ready to start
        const { rows } = await db.execute({
          sql: `SELECT 
            (SELECT COUNT(*) FROM players WHERE table_id = ? AND status = 'waiting') as total,
            (SELECT COUNT(*) FROM players WHERE table_id = ? AND is_ready = 1) as ready`,
          args: [tableId, tableId],
        });
        const counts = rows[0] as any;
        const allReady = counts.total > 1 && counts.total === counts.ready;
        
        return NextResponse.json({ success: true, allReady, playerCount: counts.total });
      }

      case 'chat': {
        if (!fid || !tableId || !message) {
          return NextResponse.json({ error: 'fid, tableId, and message required' }, { status: 400 });
        }
        await db.execute({
          sql: `INSERT INTO table_chat_messages (table_id, fid, username, message) VALUES (?, ?, ?, ?)`,
          args: [tableId, fid, username || `Player_${fid}`, message],
        });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Lobby API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
