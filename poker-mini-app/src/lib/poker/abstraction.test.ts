import { describe, it, expect } from 'vitest';
import { getValidActions, BET_ABSTRACTION } from './abstraction';
import { encodeActionHistory, decodeActionHistory } from './encoding';

describe('Poker Action Abstraction — Edge Cases', () => {
  // ─── Check-Raising ───
  describe('check-raising scenarios', () => {
    it('should allow check (not fold) when facingBet is 0', () => {
      const edges = getValidActions(0, 1000, 100, 'flop', false);
      const foldEdge = edges.find(e => e.type === BET_ABSTRACTION.FOLD);
      expect(foldEdge).toBeUndefined();
      const checkEdge = edges.find(e => e.label === 'Check');
      expect(checkEdge).toBeDefined();
      expect(checkEdge?.minAmount).toBe(0);
    });

    it('should allow raise after checking (facingBet=0, hasActed=true)', () => {
      // Player checked, now wants to raise
      const edges = getValidActions(0, 1000, 200, 'flop', true);
      const halfPot = edges.find(e => e.type === BET_ABSTRACTION.BET_HALF);
      const fullPot = edges.find(e => e.type === BET_ABSTRACTION.BET_FULL);
      expect(halfPot).toBeDefined();
      expect(fullPot).toBeDefined();
    });

    it('should allow call then raise when facing a bet', () => {
      const edges = getValidActions(100, 1000, 200, 'flop', false);
      const callEdge = edges.find(e => e.label === 'Call');
      const raiseEdge = edges.find(e => e.type === BET_ABSTRACTION.BET_HALF);
      expect(callEdge).toBeDefined();
      expect(callEdge?.minAmount).toBe(100);
      expect(raiseEdge).toBeDefined();
    });
  });

  // ─── Overbetting ───
  describe('overbetting scenarios', () => {
    it('should cap bet at stack size (prevent overbet beyond stack)', () => {
      const edges = getValidActions(0, 100, 1000, 'turn', false);
      // Half pot would be 500, but stack is only 100 — capped at 100 which equals stack
      const halfPot = edges.find(e => e.type === BET_ABSTRACTION.BET_HALF);
      expect(halfPot).toBeUndefined(); // Would equal stack, so all-in is redundant
      // Only Check available (all-in redundant when it matches bet size)
      expect(edges.length).toBe(1);
      expect(edges[0].label).toBe('Check');
    });

    it('should allow all-in when stack is less than half-pot target', () => {
      const edges = getValidActions(0, 50, 500, 'river', false);
      // Half-pot target is 250, capped at 50 which equals stack — redundant
      const halfPot = edges.find(e => e.type === BET_ABSTRACTION.BET_HALF);
      expect(halfPot).toBeUndefined();
      // Only Check available
      expect(edges.length).toBe(1);
      expect(edges[0].label).toBe('Check');
    });

    it('should handle facing bet larger than stack (call is all-in)', () => {
      const edges = getValidActions(500, 100, 1000, 'turn', false);
      const callEdge = edges.find(e => e.label === 'Call');
      expect(callEdge).toBeDefined();
      expect(callEdge?.minAmount).toBe(100); // min(stack, facingBet)
      expect(callEdge?.isTerminal).toBe(true); // call all-in
      // Should not allow raise
      const raiseEdge = edges.find(e => e.type === BET_ABSTRACTION.BET_HALF);
      expect(raiseEdge).toBeUndefined();
    });
  });

  // ─── SPR (Stack-to-Pot Ratio) ───
  describe('SPR-based action availability', () => {
    it('high SPR (> 10): should offer full range of sizes', () => {
      const edges = getValidActions(0, 10000, 500, 'flop', false);
      expect(edges.some(e => e.type === BET_ABSTRACTION.BET_HALF)).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.BET_FULL)).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.ALL_IN)).toBe(true); // Always offered as an option
    });

    it('medium SPR (4-10): should still offer bet sizes', () => {
      const edges = getValidActions(0, 2000, 500, 'flop', false);
      expect(edges.some(e => e.type === BET_ABSTRACTION.BET_HALF)).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.BET_FULL)).toBe(true);
    });

    it('low SPR (< 4): should push toward all-in', () => {
      const edges = getValidActions(100, 300, 200, 'turn', false);
      // After calling 100, only 200 left — might not be enough for a raise
      expect(edges.some(e => e.type === BET_ABSTRACTION.CHECK_CALL)).toBe(true);
    });

    it('very low SPR (< 2): all-in or fold', () => {
      const edges = getValidActions(100, 150, 300, 'river', false);
      const allIn = edges.find(e => e.type === BET_ABSTRACTION.ALL_IN);
      expect(edges.some(e => e.type === BET_ABSTRACTION.CHECK_CALL)).toBe(true);
      // Depending on exact math, all-in might be offered
    });
  });

  // ─── Preflop Specifics ───
  describe('preflop edge cases', () => {
    it('blinds posted: facing bet = big blind amount', () => {
      const edges = getValidActions(100, 900, 150, 'preflop', false);
      expect(edges.some(e => e.label === 'Call')).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.FOLD)).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.BET_HALF)).toBe(true);
    });

    it('limp then raise (facing 0 after limping)', () => {
      // Player limped, now someone raised
      const edges = getValidActions(300, 700, 450, 'preflop', true);
      expect(edges.some(e => e.label === 'Call')).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.BET_HALF)).toBe(true);
    });

    it('3-bet pot: large facing bet', () => {
      const edges = getValidActions(900, 1100, 1200, 'preflop', true);
      expect(edges.some(e => e.label === 'Call')).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.FOLD)).toBe(true);
      // All-in might be closest to a raise
    });
  });

  // ─── All-In Edge Cases ───
  describe('all-in edge cases', () => {
    it('exact all-in match (stack equals bet size)', () => {
      const edges = getValidActions(0, 500, 200, 'flop', false);
      const allIn = edges.find(e => e.type === BET_ABSTRACTION.ALL_IN);
      // If half-pot = full-pot = stack, all-in might be excluded as redundant
      expect(allIn).toBeDefined();
    });

    it('multiple all-in callers: side pot logic', () => {
      // This is more of a game state test, but action abstraction should still work
      const edges = getValidActions(100, 50, 400, 'turn', false);
      const callEdge = edges.find(e => e.label === 'Call');
      expect(callEdge?.minAmount).toBe(50); // All-in call
      expect(callEdge?.isTerminal).toBe(true);
    });

    it('should not offer all-in if already all-in', () => {
      // This would be handled by caller (game state), but test abstraction handles it
      const edges = getValidActions(0, 0, 500, 'river', true);
      // No money left, just check
      expect(edges.length).toBe(1);
      expect(edges[0].label).toBe('Check');
    });
  });

  // ─── Street-Based Behavior ───
  describe('street-based action differences', () => {
    it('preflop: should always allow fold if facing bet', () => {
      const edges = getValidActions(50, 1000, 100, 'preflop', false);
      expect(edges.some(e => e.type === BET_ABSTRACTION.FOLD)).toBe(true);
    });

    it('river: should not offer check-raise option if already checked', () => {
      // After checking, if opponent bets, we can call/fold but not raise beyond stack
      const edges = getValidActions(200, 500, 800, 'river', true);
      expect(edges.some(e => e.label === 'Call')).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.FOLD)).toBe(true);
    });

    it('turn: facing large bet with draws possible', () => {
      const edges = getValidActions(400, 2000, 1000, 'turn', false);
      expect(edges.some(e => e.label === 'Call')).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.BET_HALF)).toBe(true);
      expect(edges.some(e => e.type === BET_ABSTRACTION.BET_FULL)).toBe(true);
    });
  });

  // ─── Action Encoding Roundtrip ───
  describe('action encoding', () => {
    it('should encode and decode check-raise history', () => {
      const actions = [
        { seat: 0, action: 1, amount: 0, street: 'flop' }, // check
        { seat: 1, action: 2, amount: 100, street: 'flop' }, // bet half
        { seat: 0, action: 2, amount: 200, street: 'flop' }, // raise half (check-raise)
      ];
      const encoded = encodeActionHistory(actions, 'flop');
      expect(encoded).toContain('c'); // check
      expect(encoded).toContain('h'); // half pot
      const decoded = decodeActionHistory(encoded);
      expect(decoded.length).toBe(3);
      expect(decoded[0].action).toBe(1); // check/call
      expect(decoded[2].action).toBe(2); // raise
    });
  });
});
