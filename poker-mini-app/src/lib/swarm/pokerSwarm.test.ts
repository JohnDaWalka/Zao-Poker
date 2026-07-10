import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PokerSwarm,
  parseFramePayload,
  calculateOdds,
  buildFrameResponse,
  generateSettlement,
  verifyGameState,
} from './pokerSwarm';
import { buildInfoSet, hashInfoSet } from '~/lib/poker/state';

describe('PokerSwarm', () => {
  let swarm: PokerSwarm;

  beforeEach(() => {
    swarm = new PokerSwarm();
  });

  describe('parseFramePayload (gameState agent)', () => {
    it('parses a basic Farcaster payload', () => {
      const payload = {
        untrustedData: {
          fid: 1234,
          url: 'https://example.com/game?gameId=abc',
          buttonIndex: 2,
          state: Buffer.from(JSON.stringify({ gameId: 'xyz', seat: 1, hash: 'abc123' })).toString('base64'),
        },
      };

      const result = parseFramePayload(payload);
      expect(result.playerFid).toBe(1234);
      expect(result.gameId).toBe('xyz');
      expect(result.selectedAction).toBe('check_call');
      expect(result.stateHash).toBe('abc123');
      expect(result.buttonIndex).toBe(2);
    });

    it('handles missing state gracefully', () => {
      const payload = {
        untrustedData: {
          fid: 5678,
          url: 'https://example.com/',
        },
      };

      const result = parseFramePayload(payload);
      expect(result.playerFid).toBe(5678);
      expect(result.gameId).toBe('default');
      expect(result.selectedAction).toBeNull();
      expect(result.stateHash).toBe('');
    });

    it('maps all button indices correctly', () => {
      const actions = ['fold', 'check_call', 'bet_half', 'bet_full', 'all_in'];
      for (let i = 1; i <= 5; i++) {
        const payload = {
          untrustedData: { fid: 1, url: '', buttonIndex: i },
        };
        expect(parseFramePayload(payload).selectedAction).toBe(actions[i - 1]);
      }
    });

    it('returns null for unknown button index', () => {
      const payload = {
        untrustedData: { fid: 1, url: '', buttonIndex: 99 },
      };
      expect(parseFramePayload(payload).selectedAction).toBeNull();
    });
  });

  describe('calculateOdds (oddsCalc agent)', () => {
    it('calculates pot odds correctly', () => {
      const result = calculateOdds(100, 20, 500, 'flop', ['As', 'Ks'], ['Qd', 'Jd', 'Td']);
      expect(result.potOdds).toBeGreaterThan(0);
      expect(result.potOdds).toBeLessThan(1);
      expect(result.minEquity).toBeGreaterThan(0);
    });

    it('recommends raise with strong equity', () => {
      // Pocket Aces on dry board should recommend raise
      const result = calculateOdds(100, 0, 1000, 'flop', ['Ad', 'Ac'], ['7h', '2s', '3d']);
      expect(result.equity).toBeGreaterThan(0.7);
      expect(result.recommendation).toBe('raise');
      expect(result.confidence).toBeGreaterThan(0.6);
    });

    it('recommends fold with weak equity facing large bet', () => {
      // 7-2 offsuit on coordinated board facing big bet
      const result = calculateOdds(100, 80, 200, 'flop', ['7c', '2d'], ['As', 'Ks', 'Qs']);
      expect(result.recommendation).toBe('fold');
    });

    it('handles river correctly (no implied odds)', () => {
      const result = calculateOdds(200, 50, 300, 'river', ['Kh', 'Qh'], ['Ah', 'Jh', 'Th', '9s', '8c']);
      expect(result.impliedOdds).toBe(result.potOdds); // No future streets
    });

    it('returns valid numbers for all fields', () => {
      const result = calculateOdds(150, 30, 400, 'turn', ['Js', 'Jc'], ['7d', '8h', '2s', '3d']);
      expect(Number.isFinite(result.potOdds)).toBe(true);
      expect(Number.isFinite(result.minEquity)).toBe(true);
      expect(Number.isFinite(result.impliedOdds)).toBe(true);
      expect(Number.isFinite(result.confidence)).toBe(true);
      expect(Number.isFinite(result.equity)).toBe(true);
    });

    it('handles empty community cards (preflop)', () => {
      const result = calculateOdds(15, 5, 1000, 'preflop', ['As', 'Kd'], []);
      expect(result.equity).toBeGreaterThan(0.5); // AKo is strong preflop
      expect(result.recommendation).toBe('raise');
    });

    it('handles all-in scenario', () => {
      const result = calculateOdds(100, 500, 500, 'turn', ['9s', '8s'], ['7s', '6s', '5h', '2d']);
      expect(result.potOdds).toBeCloseTo(500 / 600, 3); // 500 to call, 600 total pot
    });
  });

  describe('buildFrameResponse (farcasterFrame agent)', () => {
    it('builds a valid Frame vNext response', () => {
      const result = buildFrameResponse(
        'https://example.com',
        {
          pot: 100,
          facing: 20,
          myStack: 500,
          street: 'flop',
          myCards: ['As', 'Ks'],
          community: ['Qd', 'Jd', 'Td'],
        },
        [
          { type: 0, label: 'Fold', minAmount: 0, maxAmount: 0, isTerminal: true },
          { type: 1, label: 'Call', minAmount: 20, maxAmount: 20, isTerminal: false },
        ],
        'hash123',
        'game1',
        0
      );

      expect(result.version).toBe('vNext');
      expect(result.image).toContain('scene=table');
      expect(result.image).toContain('h=hash123');
      expect(result.buttons).toHaveLength(2);
      expect(result.buttons[0].label).toBe('Fold');
      expect(result.postUrl).toBe('https://example.com/api/poker/swarm');
      expect(result.state).toBeDefined();
    });

    it('includes advice in image URL when provided', () => {
      const result = buildFrameResponse(
        'https://example.com',
        {
          pot: 100,
          facing: 20,
          myStack: 500,
          street: 'flop',
          myCards: ['As', 'Ks'],
          community: ['Qd', 'Jd', 'Td'],
        },
        [{ type: 1, label: 'Call', minAmount: 20, maxAmount: 20, isTerminal: false }],
        'hash123',
        'game1',
        0,
        'Call for pot odds'
      );

      expect(result.image).toContain('advice=Call+for+pot+odds');
      expect(result.buttons.some((b) => b.label.includes('💡'))).toBe(true);
    });

    it('encodes frame state correctly', () => {
      const result = buildFrameResponse(
        'https://example.com',
        {
          pot: 50,
          facing: 10,
          myStack: 200,
          street: 'preflop',
          myCards: ['Ah', 'Kh'],
          community: [],
        },
        [],
        'abc',
        'mygame',
        2
      );

      const decoded = JSON.parse(Buffer.from(result.state!, 'base64').toString());
      expect(decoded.gameId).toBe('mygame');
      expect(decoded.seat).toBe(2);
      expect(decoded.hash).toBe('abc');
    });
  });

  describe('generateSettlement (blockchain agent)', () => {
    it('generates settlement calldata', () => {
      const result = generateSettlement(
        [{ fid: 123, amount: 100 }],
        [{ fid: 123, amount: 100 }, { fid: 456, amount: 50 }],
        'table_1'
      );

      expect(result.functionName).toBe('settleHand');
      expect(result.args).toHaveLength(5);
      expect(result.status).toBe('simulated');
      expect(Number(result.chainId)).toBeGreaterThan(0);
    });

    it('converts amounts to 6 decimal precision', () => {
      const result = generateSettlement(
        [{ fid: 1, amount: 50.5 }],
        [{ fid: 1, amount: 50.5 }],
        't1'
      );

      const winnerAmounts = result.args[2] as number[];
      expect(winnerAmounts[0]).toBe(50500000); // 50.5 * 1e6
    });
  });

  describe('verifyGameState', () => {
    it('verifies correct state hash', () => {
      const publicState = {
        pot: 100,
        communityCards: ['Ah', 'Kd', '7c'] as string[],
        activeSeat: 0,
        street: 'flop' as const,
        actionHistory: '1c2h',
        lastAggressor: 2,
        currentBet: 50,
        stacks: { 0: 500, 1: 400 } as Record<number, number>,
      };
      const infoSet = buildInfoSet(publicState, 0, ['Qs', 'Jh']);
      const hash = hashInfoSet(infoSet, 'test-secret');

      expect(verifyGameState(publicState, 0, ['Qs', 'Jh'], hash, 'test-secret')).toBe(true);
    });

    it('rejects tampered state hash', () => {
      const publicState = {
        pot: 100,
        communityCards: ['Ah', 'Kd', '7c'],
        activeSeat: 0,
        street: 'flop' as const,
        actionHistory: '1c2h',
        lastAggressor: 2,
        currentBet: 50,
        stacks: { 0: 500, 1: 400 },
      };

      expect(verifyGameState(publicState, 0, ['Qs', 'Jh'], 'wronghash')).toBe(false);
    });
  });

  describe('PokerSwarm.execute', () => {
    it('returns parsed payload when no context', () => {
      const payload = {
        untrustedData: { fid: 123, url: '', buttonIndex: 1 },
      };
      const result = swarm.execute(payload, {});
      expect(result.playerFid).toBe(123);
      expect(result.selectedAction).toBe('fold');
    });

    it('returns odds when gameState provided without action', () => {
      const result = swarm.execute('{}', {
        gameState: {
          pot: 100,
          facing: 20,
          myStack: 500,
          street: 'flop',
          myCards: ['As', 'Ks'],
          community: ['Qd', 'Jd', 'Td'],
        },
      });

      expect(result).toHaveProperty('potOdds');
      expect(result).toHaveProperty('equity');
      expect(result).toHaveProperty('recommendation');
    });

    it('returns frame response when action provided', () => {
      const result = swarm.execute('{}', {
        gameState: {
          pot: 100,
          facing: 20,
          myStack: 500,
          street: 'flop',
          myCards: ['As', 'Ks'],
          community: ['Qd', 'Jd', 'Td'],
        },
        action: '1',
      });

      expect(result.version).toBe('vNext');
      expect(result.image).toContain('api/poker/frame');
    });

    it('returns settlement when terminal', () => {
      const result = swarm.execute('{}', {
        gameState: {
          pot: 200,
          facing: 0,
          myStack: 500,
          street: 'river',
          myCards: ['As', 'Ks'],
          community: ['Ah', 'Kd', '7c', '2s', '3d'],
          isTerminal: true,
          winners: [{ fid: 1, amount: 200 }],
          payouts: [{ fid: 1, amount: 200 }],
        },
      });

      expect(result.functionName).toBe('settleHand');
      expect(result.status).toBe('simulated');
    });
  });

  describe('PokerSwarm convenience methods', () => {
    it('getOdds returns calculated odds', () => {
      const result = swarm.getOdds(100, 20, 500, 'flop', ['As', 'Ks'], ['Qd', 'Jd', 'Td']);
      expect(result.potOdds).toBeGreaterThan(0);
      expect(result.equity).toBeGreaterThan(0);
    });

    it('buildFrame returns frame response', () => {
      const result = swarm.buildFrame(
        'https://example.com',
        {
          pot: 50,
          facing: 10,
          myStack: 200,
          street: 'preflop',
          myCards: ['Ah', 'Kh'],
          community: [],
        },
        [{ type: 1, label: 'Call', minAmount: 10, maxAmount: 10, isTerminal: false }],
        'hash',
        'game',
        0
      );
      expect(result.version).toBe('vNext');
    });

    it('settle returns blockchain result', () => {
      const result = swarm.settle([{ fid: 1, amount: 100 }], [{ fid: 1, amount: 100 }], 't1');
      expect(result.status).toBe('simulated');
    });
  });
});
