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

    // Get game state from DB
    const gameState = await getGameState(gameId);
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

    const { table, players } = gameState;
    const player = players.find((p: any) => p.fid === fid);
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

    // Build info set and verify
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

    const infoSet = buildInfoSet(publicState, playerSeat, [holeCards[0] || '?', holeCards[1] || '?'] as [string, string]);

    // Verify state hash if present
    if (stateHash && !verifyInfoSet(infoSet, stateHash, SERVER_SECRET)) {
      return NextResponse.json({ error: 'Invalid state hash' }, { status: 403 });
    }

    // If button pressed, apply action
    let selectedAction: number | null = null;
    if (buttonIndex) {
      selectedAction = buttonIndexToAction(buttonIndex);
    }

    // Use swarm for advanced processing (odds calc, advice, frame building)
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
      action: selectedAction !== null ? String(selectedAction) : undefined,
    });

    // Get valid actions for the player
    const edges = getValidActions(
      table.current_bet,
      player.stack_size,
      table.pot_size,
      table.phase as 'preflop' | 'flop' | 'turn' | 'river',
      player.has_acted === 1
    );

    // Build next state hash
    const nextInfoSet = buildInfoSet(
      {
        ...publicState,
        activeSeat: playerSeat,
        currentBet: table.current_bet,
        pot: table.pot_size,
        stacks,
      },
      playerSeat,
      [holeCards[0] || '?', holeCards[1] || '?'] as [string, string]
    );
    const nextHash = hashInfoSet(nextInfoSet, SERVER_SECRET);

    // Encode state for next frame
    const frameState = Buffer.from(JSON.stringify({
      gameId,
      seat: playerSeat,
      hash: nextHash,
    })).toString('base64');

    // Build frame buttons from valid actions
    const buttons = edges.map((e) => ({
      label: e.label,
      action: 'post' as const,
    }));

    // Add AI advice button if swarm provided recommendation
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
    let imageUrl = `${baseUrl}/api/poker/frame?h=${nextHash}&gameId=${gameId}`;
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
