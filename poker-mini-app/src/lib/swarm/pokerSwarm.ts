/**
 * ZAO Poker Swarm — Production-ready agent orchestrator.
 * 
 * 4 specialized agents:
 * 1. gameState     — Parse Farcaster payloads, verify state integrity
 * 2. oddsCalc      — Real Monte Carlo equity + pot odds (uses lib/equity-engine.ts)
 * 3. farcasterFrame— Build Frame vNext JSON responses
 * 4. blockchain    — Settlement calldata generation (stubbed for now)
 * 
 * All agents run in the Next.js runtime. No external AI required.
 */

import { heroEquity } from '../equity-engine';
import { buildInfoSet, hashInfoSet, verifyInfoSet, PublicState } from '../poker/state';
import { getValidActions, BET_ABSTRACTION } from '../poker/abstraction';

// ─── Types ───

interface SwarmContext {
  gameState?: GameStateSnapshot;
  playerFid?: number;
  action?: string;
}

interface GameStateSnapshot {
  pot: number;
  facing: number;
  myStack: number;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  myCards: string[];
  community: string[];
  history: string;
  isTerminal?: boolean;
  winners?: Array<{ fid: number; amount: number }>;
  payouts?: Record<number, number>;
}

interface OddsResult {
  potOdds: number;
  minEquity: number;
  impliedOdds: number;
  recommendation: 'fold' | 'call' | 'raise';
  confidence: number;
  equity: number;
}

interface FrameResult {
  version: string;
  image: string;
  buttons: Array<{ label: string; action: 'post' | 'link' | 'mint' }>;
  postUrl: string;
  state?: string;
}

interface SettlementResult {
  contractAddress: string;
  functionName: string;
  args: any[];
  value: string;
  status: 'simulated' | 'ready' | 'error';
  chainId: number;
}

// ─── Exported Agent Functions (matching test API) ───

export function parseFramePayload(input: any): {
  playerFid: number;
  gameId: string;
  selectedAction: string | null;
  stateHash: string;
  buttonIndex: number | null;
} {
  const untrusted = input?.untrustedData || input;
  const fid = untrusted?.fid || 0;
  const buttonIndex = untrusted?.buttonIndex || null;
  
  let gameId = 'default';
  let stateHash = '';
  
  if (untrusted?.state) {
    try {
      const parsed = JSON.parse(Buffer.from(untrusted.state, 'base64').toString());
      gameId = parsed.gameId || gameId;
      stateHash = parsed.hash || '';
    } catch {
      // Invalid state
    }
  } else if (untrusted?.url) {
    try {
      const url = new URL(untrusted.url);
      gameId = url.searchParams.get('gameId') || gameId;
    } catch {
      // Invalid URL
    }
  }

  const actionMap: Record<number, string> = {
    1: 'fold',
    2: 'check_call',
    3: 'bet_half',
    4: 'bet_full',
    5: 'all_in',
  };

  return {
    playerFid: fid,
    gameId,
    selectedAction: buttonIndex ? actionMap[buttonIndex] || null : null,
    stateHash,
    buttonIndex,
  };
}

export function calculateOdds(
  pot: number,
  facing: number,
  myStack: number,
  street: string,
  myCards: string[],
  community: string[]
): OddsResult {
  const callAmount = Math.min(facing, myStack);
  const totalPotAfterCall = pot + callAmount;
  const potOdds = totalPotAfterCall > 0 ? callAmount / totalPotAfterCall : 0;
  const minEquity = totalPotAfterCall > 0 ? callAmount / totalPotAfterCall : 0;

  // Monte Carlo equity (deterministic seed for reproducibility)
  const equityResult = heroEquity(myCards, community, 1, 5000, 42);
  const equity = equityResult.winRate + equityResult.tieRate * 0.5;

  // Implied odds: on river, no future streets so implied = potOdds
  const streetsRemaining =
    street === 'preflop' ? 3 : street === 'flop' ? 2 : street === 'turn' ? 1 : 0;
  const impliedOdds = streetsRemaining === 0 ? potOdds : Math.min(1, equity + streetsRemaining * 0.05);

  // Recommendation
  let recommendation: 'fold' | 'call' | 'raise';
  let confidence: number;

  if (equity < minEquity * 0.7) {
    recommendation = 'fold';
    confidence = Math.min(1, 1 - equity / (minEquity || 0.01));
  } else if (equity < minEquity * 1.3) {
    recommendation = 'call';
    confidence = 0.5 + (equity - minEquity) / (minEquity || 0.01) * 0.5;
  } else {
    recommendation = 'raise';
    confidence = Math.min(1, equity);
  }

  return {
    potOdds,
    minEquity,
    impliedOdds,
    recommendation,
    confidence: Math.max(0, Math.min(1, confidence)),
    equity,
  };
}

export function buildFrameResponse(
  baseUrl: string,
  gameState: GameStateSnapshot,
  validActions: Array<{ type: number; label: string; minAmount: number; maxAmount: number; isTerminal: boolean }>,
  stateHash: string,
  gameId: string,
  playerSeat: number,
  advice?: string
): FrameResult {
  const params = new URLSearchParams();
  params.set('scene', 'table');
  params.set('community', gameState.community.join(','));
  params.set('hole', gameState.myCards.join(','));
  params.set('pot', String(gameState.pot));
  params.set('facing', String(gameState.facing));
  params.set('stack', String(gameState.myStack));
  params.set('h', stateHash);

  if (advice) {
    params.set('advice', advice);
  }

  const image = `${baseUrl}/api/poker/frame?${params.toString()}`;

  const buttons = validActions.map((e) => ({
    label: e.label,
    action: 'post' as const,
  }));

  if (advice) {
    buttons.push({ label: `💡 ${advice.slice(0, 20)}`, action: 'post' as const });
  }

  const state = Buffer.from(
    JSON.stringify({
      gameId,
      seat: playerSeat,
      hash: stateHash,
    })
  ).toString('base64');

  return {
    version: 'vNext',
    image,
    buttons,
    postUrl: `${baseUrl}/api/poker/swarm`,
    state,
  };
}

export function generateSettlement(
  winners: Array<{ fid: number; amount: number }>,
  payouts: Array<{ fid: number; amount: number }>,
  tableId: string
): SettlementResult {
  const totalPayout = payouts.reduce((sum, p) => sum + p.amount, 0);
  
  return {
    contractAddress: '0x0000000000000000000000000000000000000000',
    functionName: 'settleHand',
    args: [
      tableId,
      winners.map((w) => w.fid),
      winners.map((w) => Math.round(w.amount * 1e6)),
      payouts.map((p) => p.fid),
      payouts.map((p) => Math.round(p.amount * 1e6)),
    ],
    value: String(Math.round(totalPayout * 1e6)),
    status: 'simulated',
    chainId: 8453, // Base mainnet
  };
}

export function verifyGameState(
  publicState: PublicState,
  playerSeat: number,
  holeCards: [string, string],
  hash: string,
  secret: string
): boolean {
  const infoSet = buildInfoSet(publicState, playerSeat, holeCards);
  return verifyInfoSet(infoSet, hash, secret);
}

// ─── Swarm Orchestrator Class ───

export class PokerSwarm {
  private serverSecret: string;
  private baseUrl: string;

  constructor(options?: { serverSecret?: string; baseUrl?: string }) {
    this.serverSecret = options?.serverSecret || process.env.ZAO_SECRET || 'dev-secret';
    this.baseUrl = options?.baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  }

  execute(input: any, context: SwarmContext): any {
    const parsed = parseFramePayload(input);

    if (context.gameState) {
      const ctx = context.gameState;
      const odds = calculateOdds(ctx.pot, ctx.facing, ctx.myStack, ctx.street, ctx.myCards, ctx.community);

      if (context.action) {
        const validActions = getValidActions(
          ctx.facing,
          ctx.myStack,
          ctx.pot,
          ctx.street,
          false
        );
        return buildFrameResponse(
          this.baseUrl,
          ctx,
          validActions,
          hashInfoSet(buildInfoSet({
            pot: ctx.pot,
            communityCards: ctx.community,
            activeSeat: 0,
            street: ctx.street,
            actionHistory: ctx.history,
            lastAggressor: null,
            currentBet: ctx.facing,
            stacks: { 0: ctx.myStack },
          }, 0, [ctx.myCards[0] || '?', ctx.myCards[1] || '?']), this.serverSecret),
          'default',
          0,
          odds.recommendation
        );
      }

      if (ctx.isTerminal && ctx.winners && ctx.payouts) {
        const payoutsArray = Object.entries(ctx.payouts).map(([fid, amount]) => ({
          fid: parseInt(fid),
          amount,
        }));
        return generateSettlement(ctx.winners, payoutsArray, 'default');
      }

      return odds;
    }

    return parsed;
  }

  // Convenience methods matching test API
  getOdds(
    pot: number,
    facing: number,
    myStack: number,
    street: string,
    myCards: string[],
    community: string[]
  ): OddsResult {
    return calculateOdds(pot, facing, myStack, street, myCards, community);
  }

  buildFrame(
    baseUrl: string,
    gameState: GameStateSnapshot,
    validActions: Array<{ type: number; label: string; minAmount: number; maxAmount: number; isTerminal: boolean }>,
    stateHash: string,
    gameId: string,
    playerSeat: number
  ): FrameResult {
    return buildFrameResponse(baseUrl, gameState, validActions, stateHash, gameId, playerSeat);
  }

  settle(
    winners: Array<{ fid: number; amount: number }>,
    payouts: Array<{ fid: number; amount: number }>,
    tableId: string
  ): SettlementResult {
    return generateSettlement(winners, payouts, tableId);
  }
}

export default PokerSwarm;
