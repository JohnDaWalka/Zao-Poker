import { describe, it, expect } from "vitest";
import { buildSidePots } from "./hand-history";

describe("hand-history", () => {
  describe("buildSidePots", () => {
    it("builds a single pot when all players invested equally", () => {
      const players = [
        { fid: 1, invested: 100 },
        { fid: 2, invested: 100 },
        { fid: 3, invested: 100 },
      ];
      const pots = buildSidePots(players);
      expect(pots).toHaveLength(1);
      expect(pots[0].amount).toBe(300); // 100 * 3
      expect(pots[0].eligibleFids).toEqual([1, 2, 3]);
    });

    it("builds side pots when one player is all-in for less", () => {
      // Player 1 all-in for 50, players 2 and 3 call 100 each
      const players = [
        { fid: 1, invested: 50 },
        { fid: 2, invested: 100 },
        { fid: 3, invested: 100 },
      ];
      const pots = buildSidePots(players);
      expect(pots).toHaveLength(2);
      // Main pot: 50 * 3 = 150, all eligible
      expect(pots[0].amount).toBe(150);
      expect(pots[0].eligibleFids).toEqual([1, 2, 3]);
      // Side pot: 50 * 2 = 100, only players 2 and 3 eligible
      expect(pots[1].amount).toBe(100);
      expect(pots[1].eligibleFids).toEqual([2, 3]);
    });

    it("builds multiple side pots with multiple all-ins", () => {
      // Player 1: 50, Player 2: 100, Player 3: 200
      const players = [
        { fid: 1, invested: 50 },
        { fid: 2, invested: 100 },
        { fid: 3, invested: 200 },
      ];
      const pots = buildSidePots(players);
      expect(pots).toHaveLength(3);
      // Main pot: 50 * 3 = 150
      expect(pots[0].amount).toBe(150);
      expect(pots[0].eligibleFids).toEqual([1, 2, 3]);
      // Side pot 1: 50 * 2 = 100 (players 2 and 3)
      expect(pots[1].amount).toBe(100);
      expect(pots[1].eligibleFids).toEqual([2, 3]);
      // Side pot 2: 100 * 1 = 100 (only player 3)
      expect(pots[2].amount).toBe(100);
      expect(pots[2].eligibleFids).toEqual([3]);
    });

    it("handles heads-up correctly", () => {
      const players = [
        { fid: 1, invested: 100 },
        { fid: 2, invested: 100 },
      ];
      const pots = buildSidePots(players);
      expect(pots).toHaveLength(1);
      expect(pots[0].amount).toBe(200);
      expect(pots[0].eligibleFids).toEqual([1, 2]);
    });

    it("handles heads-up with short stack all-in", () => {
      const players = [
        { fid: 1, invested: 50 },
        { fid: 2, invested: 100 },
      ];
      const pots = buildSidePots(players);
      expect(pots).toHaveLength(2);
      // Main: 50 * 2 = 100
      expect(pots[0].amount).toBe(100);
      expect(pots[0].eligibleFids).toEqual([1, 2]);
      // Side: 50 * 1 = 50
      expect(pots[1].amount).toBe(50);
      expect(pots[1].eligibleFids).toEqual([2]);
    });

    it("ignores players with zero investment", () => {
      const players = [
        { fid: 1, invested: 100 },
        { fid: 2, invested: 100 },
        { fid: 3, invested: 0 }, // folded pre, no investment
      ];
      const pots = buildSidePots(players);
      expect(pots).toHaveLength(1);
      expect(pots[0].amount).toBe(200);
      expect(pots[0].eligibleFids).toEqual([1, 2]);
    });

    it("returns empty array when no eligible players", () => {
      const players = [
        { fid: 1, invested: 0 },
        { fid: 2, invested: 0 },
      ];
      const pots = buildSidePots(players);
      expect(pots).toEqual([]);
    });

    it("handles multi-way all-in with same short stack", () => {
      // 4 players, 2 short stacks all-in for same amount
      const players = [
        { fid: 1, invested: 50 },
        { fid: 2, invested: 50 },
        { fid: 3, invested: 100 },
        { fid: 4, invested: 100 },
      ];
      const pots = buildSidePots(players);
      expect(pots).toHaveLength(2);
      // Main: 50 * 4 = 200
      expect(pots[0].amount).toBe(200);
      expect(pots[0].eligibleFids).toEqual([1, 2, 3, 4]);
      // Side: 50 * 2 = 100
      expect(pots[1].amount).toBe(100);
      expect(pots[1].eligibleFids).toEqual([3, 4]);
    });

    it("total pot amount equals total investment", () => {
      const players = [
        { fid: 1, invested: 75 },
        { fid: 2, invested: 150 },
        { fid: 3, invested: 300 },
      ];
      const pots = buildSidePots(players);
      const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);
      const totalInvested = players.reduce((sum, p) => sum + p.invested, 0);
      expect(totalPot).toBe(totalInvested);
    });
  });
});
