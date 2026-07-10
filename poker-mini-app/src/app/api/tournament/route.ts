/**
 * Tournament API — Create, register, start, and manage poker tournaments.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createTournament,
  registerPlayer,
  startTournament,
  calculatePrizes,
  getTournamentStandings,
  initTournamentTables,
} from '~/lib/tournament-engine';
import { db } from '~/lib/db';

// Ensure tables exist
initTournamentTables().catch(console.error);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'create': {
        const { name, gameType, buyIn, maxPlayers, startingStack } = body;
        const id = await createTournament({
          name,
          gameType,
          buyIn,
          maxPlayers,
          startingStack,
        });
        return NextResponse.json({ tournamentId: id, status: 'created' });
      }

      case 'register': {
        const { tournamentId, fid, username } = body;
        const success = await registerPlayer(tournamentId, fid, username);
        return NextResponse.json({ success });
      }

      case 'start': {
        const { tournamentId } = body;
        const success = await startTournament(tournamentId);
        return NextResponse.json({ success });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Tournament API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tournamentId = searchParams.get('id');

    if (!tournamentId) {
      // List all tournaments
      const { rows } = await db.execute({
        sql: 'SELECT * FROM tournaments ORDER BY created_at DESC LIMIT 50',
      });
      return NextResponse.json({ tournaments: rows });
    }

    // Get specific tournament with standings
    const { rows: tourneyRows } = await db.execute({
      sql: 'SELECT * FROM tournaments WHERE id = ?',
      args: [tournamentId],
    });
    if (tourneyRows.length === 0) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    const tournament = tourneyRows[0] as any;
    const standings = await getTournamentStandings(tournamentId);
    const prizeDistribution = JSON.parse(tournament.prize_distribution || '[]');
    const prizes = calculatePrizes(
      tournament.buy_in,
      tournament.entry_fee,
      tournament.current_players || 0,
      prizeDistribution
    );

    return NextResponse.json({
      tournament,
      standings,
      prizes,
    });
  } catch (error) {
    console.error('Tournament API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
