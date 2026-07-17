import { NextRequest, NextResponse } from 'next/server';
import { PokerSwarm } from '~/lib/swarm/pokerSwarm';
import { getValidActions, BET_ABSTRACTION } from '~/lib/poker/abstraction';
import { buildInfoSet, hashInfoSet, verifyInfoSet } from '~/lib/poker/state';
import { encodeActionHistory } from '~/lib/poker/encoding';
import { db } from '~/lib/db';

const SERVER_SECRET = process.env.ZAO_SECRET || process.env.VERCEL_URL || 'zao-poker-dev-secret';

interface FarcasterFramePayload {
  untrustedData: {
    fid: number;
    url: string;
    messageHash: string;
    timestamp: number;
    network: number;
    buttonIndex?: number;
    inputText?: string;
    state?: string;
    castId?: { fid: number; hash: string };
  };
  trustedData?: {
    messageBytes: string;
  };
}

// Map button index to action type
function buttonIndexToAction(index: number): number | null {
  const map: Record<number, number> = {
    1: BET_ABSTRACTION.FOLD,
    2: BET_ABSTRACTION.CHECK_CALL,
    3: BET_ABSTRACTION.BET_HALF,
    4: BET_ABSTRACTION.BET_FULL,
    5: BET_ABSTRACTION.ALL_IN,
  };
  return map[index] ?? null;
}

function actionToButtonIndex(action: number): number {
  const map: Record<number, number> = {
    [BET_ABSTRACTION.FOLD]: 1,
    [BET_ABSTRACTION.CHECK_CALL]: 2,
    [BET_ABSTRACTION.BET_HALF]: 3,
    [BET_ABSTRACTION.BET_FULL]: 4,
    [BET_ABSTRACTION.ALL_IN]: 5,
  };
  return map[action] ?? 2;
}

import { startNewHand, applyAction } from '~/lib/game-engine';

async function getGameState(gameId: string) {
  const { rows: tableRows } = await db.execute({
    sql: 'SELECT * FROM tables WHERE id = ?',
    args: [gameId],
  });
  if (tableRows.length === 0) return null;
  const table = tableRows[0] as any;

  const { rows: playerRows } = await db.execute({
    sql: 'SELECT * FROM players WHERE table_id = ? ORDER BY seat_index',
    args: [gameId],
  });

  return { table, players: playerRows as any[] };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FarcasterFramePayload;
    const { untrustedData } = body;

    const fid = untrustedData?.fid;
    const buttonIndex = untrustedData?.buttonIndex;
    const state = untrustedData?.state;

    if (!fid) {
      return NextResponse.json({ error: 'FID required' }, { status: 400 });
    }

    // Parse state from Farcaster (contains gameId, seat, hash)
    let gameId = 'default';
    let playerSeat = 0;
    let stateHash = '';

    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state, 'base64').toString());
        gameId = parsed.gameId ?? gameId;
        playerSeat = parsed.seat ?? playerSeat;
        stateHash = parsed.hash ?? '';
      } catch {
        // Invalid state, use defaults
      }
    }

    // Auto-create/provision default table if missing
    let gameState = await getGameState(gameId);
    if (!gameState && (buttonIndex === 1 || buttonIndex === 2 || gameId === 'default')) {
      await db.execute({
        sql: `INSERT INTO tables (id, name, game_type, status, dealer_seat_index, max_players, pot_size, current_bet, board, deck, action_history)
              VALUES (?, 'ZAO Poker Table', 'NLHE', 'waiting', 0, 6, 0, 0, '', '', '')
              ON CONFLICT(id) DO NOTHING`,
        args: [gameId],
      });
      gameState = await getGameState(gameId);
    }

    if (!gameState) {
      // Return initial lobby frame if no game
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
      return NextResponse.json({
        type: 'frame',
        version: 'vNext',
        image: `${baseUrl}/api/poker/frame?scene=lobby`,
        buttons: [
          { label: 'Join Table', action: 'post' },
          { label: 'Create Table', action: 'post' },
          { label: 'View Leaderboard', action: 'post' },
        ],
        postUrl: `${baseUrl}/api/poker/swarm`,
      });
    }

    let { table, players } = gameState;

    // Handle starting new hand if status is 'waiting' and a button is clicked
    if (table.status === 'waiting' && buttonIndex && players.length >= 2) {
      await startNewHand(gameId);
      const refreshed = await getGameState(gameId);
      if (refreshed) {
        table = refreshed.table;
        players = refreshed.players;
      }
    }

    let player = players.find((p: any) => p.fid === fid);
    if (!player) {
      if (buttonIndex === 1) { // Take Seat
        if (players.length < table.max_players) {
          const occupiedSeats = players.map(p => p.seat_index);
          let openSeat = 0;
          for (let s = 0; s < table.max_players; s++) {
            if (!occupiedSeats.includes(s)) {
              openSeat = s;
              break;
            }
          }
          await db.execute({
            sql: `INSERT INTO players (fid, username, table_id, seat_index, stack_size, status, total_invested, current_bet, hand, visible_cards)
                  VALUES (?, ?, ?, ?, 1000, 'waiting', 0, 0, '', '')
                  ON CONFLICT(fid, table_id) DO NOTHING`,
            args: [fid, `User#${fid}`, gameId, openSeat],
          });
          const refreshed = await getGameState(gameId);
          if (refreshed) {
            table = refreshed.table;
            players = refreshed.players;
            player = players.find((p: any) => p.fid === fid);
          }
        }
      } else {
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
        return NextResponse.json({
          type: 'frame',
          version: 'vNext',
          image: `${baseUrl}/api/poker/frame?scene=not_seated`,
          buttons: [
            { label: 'Take Seat', action: 'post' },
            { label: 'Back to Lobby', action: 'post' },
          ],
          postUrl: `${baseUrl}/api/poker/swarm`,
        });
      }
    }

    if (!player) {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
      return NextResponse.json({
        type: 'frame',
        version: 'vNext',
        image: `${baseUrl}/api/poker/frame?scene=not_seated`,
        buttons: [
          { label: 'Take Seat', action: 'post' },
          { label: 'Back to Lobby', action: 'post' },
        ],
        postUrl: `${baseUrl}/api/poker/swarm`,
      });
    }

    playerSeat = player.seat_index;
    const holeCards = player.hand ? player.hand.split(',').map((c: string) => c.trim()) : [];
    const communityCards = table.board ? table.board.split(',').map((c: string) => c.trim()) : [];

    // If active turn, and button pressed, apply action
    let selectedAction: number | null = null;
    let selectedAmount = 0;

    if (table.status === 'playing' && table.current_turn_fid === fid && buttonIndex) {
      const edges = getValidActions(
        table.current_bet,
        player.stack_size,
        table.pot_size,
        table.phase as 'preflop' | 'flop' | 'turn' | 'river',
        player.has_acted === 1
      );

      if (buttonIndex >= 1 && buttonIndex <= edges.length) {
        const clickedEdge = edges[buttonIndex - 1];
        selectedAction = clickedEdge.type;
        selectedAmount = clickedEdge.minAmount;

        // Apply action to the database
        await applyAction(gameId, player.seat_index, selectedAction, selectedAmount);

        // Re-fetch state
        const refreshed = await getGameState(gameId);
        if (refreshed) {
          table = refreshed.table;
          players = refreshed.players;
          const refreshedPlayer = players.find((p) => p.fid === fid);
          if (refreshedPlayer) {
            player.stack_size = refreshedPlayer.stack_size;
            player.current_bet = refreshedPlayer.current_bet;
            player.has_acted = refreshedPlayer.has_acted;
            player.status = refreshedPlayer.status;
          }
        }
      }
    }

    // Build public stacks
    const stacks: Record<number, number> = {};
    for (const p of players) {
      if (p.seat_index !== null) stacks[p.seat_index] = p.stack_size;
    }

    const publicState = {
      pot: table.pot_size,
      communityCards,
      activeSeat: playerSeat,
      street: table.phase as 'preflop' | 'flop' | 'turn' | 'river',
      actionHistory: table.action_history || '',
      lastAggressor: table.last_aggressor_fid,
      currentBet: table.current_bet,
      stacks,
    };

    const nextInfoSet = buildInfoSet(
      publicState,
      playerSeat,
      [holeCards[0] || '?', holeCards[1] || '?'] as [string, string]
    );
    const nextHash = hashInfoSet(nextInfoSet, SERVER_SECRET);

    // Dynamic buttons
    const isMyTurn = table.current_turn_fid === fid;
    let buttons;
    if (isMyTurn && table.status === 'playing') {
      const edges = getValidActions(
        table.current_bet,
        player.stack_size,
        table.pot_size,
        table.phase as 'preflop' | 'flop' | 'turn' | 'river',
        player.has_acted === 1
      );
      buttons = edges.map((e) => ({
        label: e.label,
        action: 'post' as const,
      }));
    } else {
      buttons = [{
        label: table.status === 'playing' ? 'Refresh 🔄' : 'New Hand 🃏',
        action: 'post' as const,
      }];
    }

    // Execute swarm for GTO Advice
    const swarm = new PokerSwarm();
    const swarmResult = swarm.execute(JSON.stringify(body), {
      gameState: {
        pot: table.pot_size,
        facing: table.current_bet,
        myStack: player.stack_size,
        street: table.phase,
        myCards: holeCards,
        community: communityCards,
        history: table.action_history,
      },
      playerFid: fid,
    });

    const frameState = Buffer.from(JSON.stringify({
      gameId,
      seat: playerSeat,
      hash: nextHash,
    })).toString('base64');

    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
    let imageUrl = `${baseUrl}/api/poker/frame?h=${nextHash}&gameId=${gameId}&pot=${table.pot_size}&street=${table.phase}&community=${communityCards.join(',')}&hole=${holeCards.join(',')}&stack=${player.stack_size}&facing=${table.current_bet - player.current_bet}`;
    const advice = (swarmResult as any)?.recommendation;
    if (advice) {
      imageUrl += `&advice=${encodeURIComponent(advice)}`;
    }

    return NextResponse.json({
      type: 'frame',
      version: 'vNext',
      image: imageUrl,
      buttons,
      postUrl: `${baseUrl}/api/poker/swarm`,
      state: frameState,
    });
  } catch (error) {
    console.error('Poker swarm API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
