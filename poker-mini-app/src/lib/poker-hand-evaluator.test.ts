import { describe, it, expect } from "vitest";
import {
  rankValue,
  suitOf,
  combinations,
  bestHandRank,
  compareHandRanks,
  rankShowdownWinners,
  getLowHandRank,
  compareLowHandRanks,
  getBestOmaha8Hand,
  rankHighLowShowdown,
  type Card,
} from "./poker-hand-evaluator";

describe("poker-hand-evaluator", () => {
  /* ─────────── basic helpers ─────────── */
  describe("rankValue", () => {
    it("returns correct rank values", () => {
      expect(rankValue("Ah")).toBe(14);
      expect(rankValue("Td")).toBe(10);
      expect(rankValue("2c")).toBe(2);
      expect(rankValue("Ks")).toBe(13);
    });
  });

  describe("suitOf", () => {
    it("returns the suit character", () => {
      expect(suitOf("Ah")).toBe("h");
      expect(suitOf("Td")).toBe("d");
    });
  });

  describe("combinations", () => {
    it("returns correct combinations", () => {
      expect(combinations([1, 2, 3], 2)).toEqual([
        [1, 2],
        [1, 3],
        [2, 3],
      ]);
      expect(combinations(["a", "b"], 0)).toEqual([[]]);
      expect(combinations(["a"], 2)).toEqual([]);
    });
  });

  /* ─────────── 5-card high hand evaluation ─────────── */
  describe("bestHandRank", () => {
    it("identifies royal flush", () => {
      const rank = bestHandRank(["Ah", "Kh"], ["Qh", "Jh", "Th", "2d", "3c"]);
      expect(rank[0]).toBe(8); // straight flush
      expect(rank[1]).toBe(14); // Ace-high straight
    });

    it("identifies quads", () => {
      const rank = bestHandRank(["Ac", "Ad"], ["Ah", "As", "2d", "3c", "4s"]);
      expect(rank[0]).toBe(7); // quads
      expect(rank[1]).toBe(14); // Aces
    });

    it("identifies full house", () => {
      const rank = bestHandRank(["Ac", "Ad"], ["Ah", "Ks", "Kd", "2c", "3s"]);
      expect(rank[0]).toBe(6); // full house
    });

    it("identifies flush", () => {
      const rank = bestHandRank(["Ah", "Kh"], ["Qh", "7h", "2h", "3c", "4s"]);
      expect(rank[0]).toBe(5); // flush
    });

    it("identifies straight", () => {
      const rank = bestHandRank(["5c", "6d"], ["7h", "8s", "9c", "2d", "3h"]);
      expect(rank[0]).toBe(4); // straight
      expect(rank[1]).toBe(9); // 9-high
    });

    it("identifies wheel (A-2-3-4-5)", () => {
      const rank = bestHandRank(["Ac", "2d"], ["3h", "4s", "5c", "Kd", "Qh"]);
      expect(rank[0]).toBe(4); // straight
      expect(rank[1]).toBe(5); // 5-high (wheel)
    });

    it("identifies trips", () => {
      const rank = bestHandRank(["Ac", "Ad"], ["Ah", "Ks", "2d", "3c", "4s"]);
      expect(rank[0]).toBe(3); // trips
    });

    it("identifies two pair", () => {
      const rank = bestHandRank(["Ac", "Ad"], ["Ks", "Kd", "2h", "3c", "4s"]);
      expect(rank[0]).toBe(2); // two pair
    });

    it("identifies one pair", () => {
      const rank = bestHandRank(["Ac", "Ad"], ["Ks", "2d", "3h", "7c", "8s"]);
      expect(rank[0]).toBe(1); // one pair
    });

    it("identifies high card", () => {
      const rank = bestHandRank(["Ac", "Kd"], ["Qs", "Jh", "9c", "7d", "5s"]);
      expect(rank[0]).toBe(0); // high card
    });

    it("handles less than 5 cards gracefully", () => {
      const rank = bestHandRank(["Ac", "Kd"], []);
      expect(rank[0]).toBe(0); // high card
      expect(rank[1]).toBe(14); // Ace
      expect(rank[2]).toBe(13); // King
    });
  });

  describe("compareHandRanks", () => {
    it("compares hands correctly", () => {
      const royalFlush = bestHandRank(["Ah", "Kh"], ["Qh", "Jh", "Th"]);
      const highCard = bestHandRank(["2c", "3d"], ["4h", "5s", "7c"]);
      expect(compareHandRanks(royalFlush, highCard)).toBeGreaterThan(0);
      expect(compareHandRanks(highCard, royalFlush)).toBeLessThan(0);
      expect(compareHandRanks(royalFlush, royalFlush)).toBe(0);
    });
  });

  describe("rankShowdownWinners", () => {
    it("finds single winner", () => {
      const players = [
        { holeCards: ["Ah", "Kh"] }, // Royal flush draw
        { holeCards: ["2c", "3d"] }, // Weak hand
      ];
      const board = ["Qh", "Jh", "Th", "2d", "3c"];
      expect(rankShowdownWinners(players, board)).toEqual([0]);
    });

    it("detects split pot", () => {
      const players = [
        { holeCards: ["7c", "7d"] },
        { holeCards: ["7h", "7s"] },
      ];
      const board = ["Ac", "Kd", "Qh", "Js", "9c"];
      expect(rankShowdownWinners(players, board)).toEqual([0, 1]);
    });

    it("handles kicker differences", () => {
      const players = [
        { holeCards: ["Ac", "Kd"] }, // Pair of Aces, K kicker
        { holeCards: ["Ad", "Qd"] }, // Pair of Aces, Q kicker
      ];
      const board = ["As", "2h", "3c", "7d", "8s"];
      expect(rankShowdownWinners(players, board)).toEqual([0]);
    });
  });

  /* ─────────── low hand evaluation ─────────── */
  describe("getLowHandRank", () => {
    it("returns null for non-qualifying hands", () => {
      expect(getLowHandRank(["Ah", "2d", "3c", "4s", "5h"])).not.toBeNull(); // qualifies
      expect(getLowHandRank(["Ah", "2d", "3c", "4s", "9h"])).toBeNull(); // 9 > 8
      expect(getLowHandRank(["Ah", "2d", "3c", "4s"])).toBeNull(); // not enough cards
      expect(getLowHandRank(["Ah", "2d", "3c", "4s", "4h"])).toBeNull(); // pair
    });

    it("returns correct low rank for wheel (best low)", () => {
      const low = getLowHandRank(["Ah", "2d", "3c", "4s", "5h"]);
      expect(low).toEqual([1, 2, 3, 4, 5]);
    });

    it("returns correct low rank for 8-high", () => {
      const low = getLowHandRank(["2d", "3c", "4s", "5h", "8d"]);
      expect(low).toEqual([2, 3, 4, 5, 8]);
    });

    it("ignores 6th+ card when 5+ cards present", () => {
      const low = getLowHandRank(["Ah", "2d", "3c", "4s", "5h", "6d", "7c"]);
      expect(low).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("compareLowHandRanks", () => {
    it("lower hand wins", () => {
      const wheel = [1, 2, 3, 4, 5];
      const eightHigh = [2, 3, 4, 5, 8];
      expect(compareLowHandRanks(wheel, eightHigh)).toBeLessThan(0);
      expect(compareLowHandRanks(eightHigh, wheel)).toBeGreaterThan(0);
      expect(compareLowHandRanks(wheel, wheel)).toBe(0);
    });
  });

  /* ─────────── Omaha-8 specific ─────────── */
  describe("getBestOmaha8Hand", () => {
    it("uses exactly 2 hole + 3 board for high", () => {
      // A-high flush using Ah Kh from hole + 3 hearts on board
      const result = getBestOmaha8Hand(
        ["Ah", "Kh", "2d", "3c"],
        ["Qh", "Jh", "Th", "2s", "3d"]
      );
      expect(result.high[0]).toBe(8); // straight flush
    });

    it("uses exactly 2 hole + 3 board for low", () => {
      // A2 from hole + 345 from board = wheel (best low)
      const result = getBestOmaha8Hand(
        ["Ah", "2d", "Ks", "Qh"],
        ["3c", "4s", "5h", "Td", "9c"]
      );
      expect(result.low).toEqual([1, 2, 3, 4, 5]);
    });

    it("returns null low when no qualifying low", () => {
      // No A-2 combo available with 3 low board cards
      const result = getBestOmaha8Hand(
        ["Kh", "Qd", "Js", "Th"],
        ["9c", "8h", "7d", "6s", "5c"]
      );
      expect(result.low).toBeNull();
    });

    it("finds best low among many combinations", () => {
      // A2 and A3 in hole, board has 4,5,6,7,8 -> best low is A2+456 = 6-high
      const result = getBestOmaha8Hand(
        ["Ah", "2d", "3c", "Ks"],
        ["4h", "5s", "6d", "7c", "8h"]
      );
      expect(result.low).toEqual([1, 2, 4, 5, 6]);
    });
  });

  /* ─────────── high-low showdown ─────────── */
  describe("rankHighLowShowdown", () => {
    it("scoops both high and low with best hands", () => {
      const players = [
        { fid: 1, username: "A", holeCards: ["Ah", "2d", "3c", "4s"], invested: 100 }, // A2-3456 low + straight high
        { fid: 2, username: "B", holeCards: ["Kh", "Qd", "Js", "Th"], invested: 100 }, // No low, straight high
      ];
      const board = ["3h", "4d", "5c", "6s", "7h"];
      const result = rankHighLowShowdown(players, board, "O8B");
      // Player 1 has A2 for low = 1,2,3,4,5 (wheel) and straight 3-4-5-6-7
      // Player 2 has no low, straight KQJ-10-7? Wait, KQJ+10,7 = no straight
      // Actually player 2 has no straight on this board
      expect(result.highWinners).toContain(1);
      expect(result.lowWinners).toContain(1);
    });

    it("splits high and low between different players", () => {
      // Player 1: flush (high), no low
      // Player 2: wheel (low), straight (high but loses to flush)
      const players = [
        { fid: 1, username: "A", holeCards: ["Ad", "Kd", "2h", "3s"], invested: 100 },
        { fid: 2, username: "B", holeCards: ["As", "2s", "3h", "4c"], invested: 100 },
      ];
      const board = ["3d", "4d", "5d", "9c", "Th"];
      const result = rankHighLowShowdown(players, board, "O8B");
      // Player 1: Ad Kd + 3d 4d 5d = Ace-high flush (wins high)
      // Player 2: As 2s + 3d 4d 5d = A-2-3-4-5 wheel (wins low)
      expect(result.highWinners).toContain(1);
      expect(result.lowWinners).toContain(2);
    });

    it("no qualifying low returns empty lowWinners", () => {
      const players = [
        { fid: 1, username: "A", holeCards: ["Kh", "Qd", "Js", "Th"], invested: 100 },
        { fid: 2, username: "B", holeCards: ["Kd", "Qh", "Jc", "9s"], invested: 100 },
      ];
      const board = ["Tc", "9h", "8d", "7s", "6c"];
      const result = rankHighLowShowdown(players, board, "O8B");
      expect(result.highWinners.length).toBeGreaterThan(0);
      expect(result.lowWinners).toEqual([]);
    });

    it("handles STUD8 high-low correctly", () => {
      // Stud-8: best 5 from 7 for both high and low
      const players = [
        { fid: 1, username: "A", holeCards: ["Ah", "2d", "3c", "4s", "5h", "6d", "7c"], invested: 100 },
        { fid: 2, username: "B", holeCards: ["Kh", "Kd", "Kc", "2s", "3h", "4d", "5c"], invested: 100 },
      ];
      const result = rankHighLowShowdown(players, [], "STUD8");
      // Player 1: high = straight 3-4-5-6-7, low = wheel
      // Player 2: high = trips Kings, low = 2,3,4,5,K = no, must be 8-or-better
      // Actually player 2 low = [2,3,4,5,13] which is > 8, so no low
      expect(result.highWinners).toContain(1); // straight beats trips
      expect(result.lowWinners).toContain(1); // wheel
      expect(result.lowWinners).not.toContain(2); // no qualifying low
    });
  });
});
