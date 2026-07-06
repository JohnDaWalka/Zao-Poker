import { describe, it, expect } from "vitest";
import {
  getGameConfig,
  isValidVariant,
  getNextStreet,
  getPreviousStreet,
  getStreet,
  usesBoard,
  usesBlinds,
  usesAnteBringIn,
  getFirstToAct,
  findLowestVisibleCard,
  findHighestHandShowing,
  calculateForcedBets,
  calculateBringIn,
  getMinBet,
  getMaxBet,
  parseHand,
  buildHand,
  addCardToHand,
  addVisibleCard,
  type PlayerForActing,
} from "./game-rules";

describe("game-rules", () => {
  describe("getGameConfig", () => {
    it("returns NLHE config by default", () => {
      const config = getGameConfig("NLHE");
      expect(config.variant).toBe("NLHE");
      expect(config.holeCardCount).toBe(2);
      expect(config.bettingLimit).toBe("NL");
      expect(config.showdownType).toBe("high");
    });

    it("returns PLO config", () => {
      const config = getGameConfig("PLO");
      expect(config.variant).toBe("PLO");
      expect(config.holeCardCount).toBe(4);
      expect(config.bettingLimit).toBe("PL");
    });

    it("returns O8B config", () => {
      const config = getGameConfig("O8B");
      expect(config.variant).toBe("O8B");
      expect(config.showdownType).toBe("high-low");
    });

    it("returns STUD config", () => {
      const config = getGameConfig("STUD");
      expect(config.variant).toBe("STUD");
      expect(config.holeCardCount).toBe(7);
      expect(config.forcedBet).toBe("ante-bringin");
      expect(config.bettingLimit).toBe("FL-stud");
    });

    it("returns STUD8 config", () => {
      const config = getGameConfig("STUD8");
      expect(config.variant).toBe("STUD8");
      expect(config.showdownType).toBe("high-low");
    });

    it("falls back to NLHE for unknown variant", () => {
      const config = getGameConfig("UNKNOWN" as any);
      expect(config.variant).toBe("NLHE");
    });
  });

  describe("isValidVariant", () => {
    it("accepts valid variants", () => {
      expect(isValidVariant("NLHE")).toBe(true);
      expect(isValidVariant("PLO")).toBe(true);
      expect(isValidVariant("O8B")).toBe(true);
      expect(isValidVariant("STUD")).toBe(true);
      expect(isValidVariant("STUD8")).toBe(true);
    });

    it("rejects invalid variants", () => {
      expect(isValidVariant("HOLDEM")).toBe(false);
      expect(isValidVariant("RANDOM")).toBe(false);
      expect(isValidVariant("")).toBe(false);
    });
  });

  describe("street navigation", () => {
    it("getNextStreet advances correctly for NLHE", () => {
      const config = getGameConfig("NLHE");
      expect(getNextStreet(config, "preflop")?.phase).toBe("flop");
      expect(getNextStreet(config, "flop")?.phase).toBe("turn");
      expect(getNextStreet(config, "turn")?.phase).toBe("river");
      expect(getNextStreet(config, "river")?.phase).toBe("showdown");
      expect(getNextStreet(config, "showdown")).toBeNull();
    });

    it("getNextStreet advances correctly for STUD", () => {
      const config = getGameConfig("STUD");
      expect(getNextStreet(config, "3rd")?.phase).toBe("4th");
      expect(getNextStreet(config, "4th")?.phase).toBe("5th");
      expect(getNextStreet(config, "5th")?.phase).toBe("6th");
      expect(getNextStreet(config, "6th")?.phase).toBe("7th");
      expect(getNextStreet(config, "7th")?.phase).toBe("showdown");
    });

    it("getPreviousStreet goes back correctly", () => {
      const config = getGameConfig("NLHE");
      expect(getPreviousStreet(config, "flop")?.phase).toBe("preflop");
      expect(getPreviousStreet(config, "preflop")).toBeNull();
    });

    it("getStreet finds specific street", () => {
      const config = getGameConfig("NLHE");
      const street = getStreet(config, "turn");
      expect(street?.name).toBe("Turn");
      expect(street?.boardCards).toBe(1);
    });
  });

  describe("variant helpers", () => {
    it("usesBoard detects board variants", () => {
      expect(usesBoard(getGameConfig("NLHE"))).toBe(true);
      expect(usesBoard(getGameConfig("STUD"))).toBe(false);
    });

    it("usesBlinds detects blind variants", () => {
      expect(usesBlinds(getGameConfig("NLHE"))).toBe(true);
      expect(usesBlinds(getGameConfig("STUD"))).toBe(false);
    });

    it("usesAnteBringIn detects stud variants", () => {
      expect(usesAnteBringIn(getGameConfig("STUD"))).toBe(true);
      expect(usesAnteBringIn(getGameConfig("STUD8"))).toBe(true);
      expect(usesAnteBringIn(getGameConfig("NLHE"))).toBe(false);
    });
  });

  describe("findLowestVisibleCard", () => {
    it("finds lowest card by rank then suit", () => {
      const players: PlayerForActing[] = [
        { fid: 1, seatIndex: 0, hand: [], visibleCards: ["3c"], status: "playing" },
        { fid: 2, seatIndex: 1, hand: [], visibleCards: ["2d"], status: "playing" },
        { fid: 3, seatIndex: 2, hand: [], visibleCards: ["2c"], status: "playing" },
      ];
      // 2c < 2d < 3c
      expect(findLowestVisibleCard(players)?.fid).toBe(3);
    });

    it("handles same rank, different suit", () => {
      const players: PlayerForActing[] = [
        { fid: 1, seatIndex: 0, hand: [], visibleCards: ["Ac"], status: "playing" },
        { fid: 2, seatIndex: 1, hand: [], visibleCards: ["Ad"], status: "playing" },
      ];
      // Ac (club) < Ad (diamond) in suit order
      expect(findLowestVisibleCard(players)?.fid).toBe(1);
    });

    it("returns null for no visible cards", () => {
      const players: PlayerForActing[] = [
        { fid: 1, seatIndex: 0, hand: [], visibleCards: [], status: "playing" },
      ];
      expect(findLowestVisibleCard(players)).toBeNull();
    });
  });

  describe("findHighestHandShowing", () => {
    it("finds highest visible hand", () => {
      const players: PlayerForActing[] = [
        { fid: 1, seatIndex: 0, hand: [], visibleCards: ["Ac", "Ad"], status: "playing" }, // pair of Aces
        { fid: 2, seatIndex: 1, hand: [], visibleCards: ["Kh", "Kd"], status: "playing" }, // pair of Kings
        { fid: 3, seatIndex: 2, hand: [], visibleCards: ["Qs", "Jh"], status: "playing" }, // high card
      ];
      expect(findHighestHandShowing(players)?.fid).toBe(1);
    });
  });

  describe("getFirstToAct", () => {
    const makePlayers = (count: number): PlayerForActing[] =>
      Array.from({ length: count }, (_, i) => ({
        fid: i + 1,
        seatIndex: i,
        hand: [],
        visibleCards: [],
        status: "playing",
      }));

    it("NLHE preflop: first to act is UTG (left of BB)", () => {
      const players = makePlayers(6);
      const fid = getFirstToAct(getGameConfig("NLHE"), "preflop", players, 0);
      // Dealer at seat 0, SB at 1, BB at 2, UTG at 3
      expect(fid).toBe(4);
    });

    it("NLHE preflop heads-up: first to act is SB (dealer)", () => {
      const players = makePlayers(2);
      const fid = getFirstToAct(getGameConfig("NLHE"), "preflop", players, 0);
      // Dealer at seat 0 = SB, first to act = SB
      expect(fid).toBe(1);
    });

    it("NLHE postflop: first to act is left of dealer", () => {
      const players = makePlayers(6);
      const fid = getFirstToAct(getGameConfig("NLHE"), "flop", players, 0);
      expect(fid).toBe(2); // seat 1 = SB acts first postflop
    });

    it("STUD 3rd street: lowest visible card acts first", () => {
      const players: PlayerForActing[] = [
        { fid: 1, seatIndex: 0, hand: [], visibleCards: ["3c"], status: "playing" },
        { fid: 2, seatIndex: 1, hand: [], visibleCards: ["2d"], status: "playing" },
        { fid: 3, seatIndex: 2, hand: [], visibleCards: ["Ah"], status: "playing" },
      ];
      const fid = getFirstToAct(getGameConfig("STUD"), "3rd", players, 0);
      // Ah = Ace (lowest in stud order), so fid 3
      expect(fid).toBe(3);
    });

    it("STUD 5th+ street: highest hand showing acts first", () => {
      const players: PlayerForActing[] = [
        { fid: 1, seatIndex: 0, hand: [], visibleCards: ["Ac", "Ad", "Ks"], status: "playing" },
        { fid: 2, seatIndex: 1, hand: [], visibleCards: ["Kh", "Kd", "Qc"], status: "playing" },
      ];
      const fid = getFirstToAct(getGameConfig("STUD"), "5th", players, 0);
      // Aces up > Kings up
      expect(fid).toBe(1);
    });
  });

  describe("calculateForcedBets", () => {
    it("posts blinds for NLHE", () => {
      const players = [
        { fid: 1, seatIndex: 0, stack: 1000 },
        { fid: 2, seatIndex: 1, stack: 1000 },
        { fid: 3, seatIndex: 2, stack: 1000 },
      ];
      const result = calculateForcedBets(
        getGameConfig("NLHE"),
        players,
        0,
        { sb: 5, bb: 10, ante: 0 }
      );
      expect(result.posts.get(2)).toBe(5); // SB
      expect(result.posts.get(3)).toBe(10); // BB
      expect(result.firstToActFid).toBe(1); // UTG
      expect(result.lastAggressorFid).toBe(3); // BB
    });

    it("posts ante + bring-in for STUD", () => {
      const players = [
        { fid: 1, seatIndex: 0, stack: 1000 },
        { fid: 2, seatIndex: 1, stack: 1000 },
        { fid: 3, seatIndex: 2, stack: 1000 },
      ];
      const result = calculateForcedBets(
        getGameConfig("STUD"),
        players,
        0,
        { sb: 5, bb: 10, ante: 0 }
      );
      // Ante = 0.25 * bb = 2.5, floored to 2 or 3 depending on implementation
      expect(result.posts.has(1)).toBe(true);
      expect(result.posts.has(2)).toBe(true);
      expect(result.posts.has(3)).toBe(true);
    });

    it("handles short stacks for blinds", () => {
      const players = [
        { fid: 1, seatIndex: 0, stack: 1000 },
        { fid: 2, seatIndex: 1, stack: 3 }, // short stack
        { fid: 3, seatIndex: 2, stack: 1000 },
      ];
      const result = calculateForcedBets(
        getGameConfig("NLHE"),
        players,
        0,
        { sb: 5, bb: 10, ante: 0 }
      );
      expect(result.posts.get(2)).toBe(3); // all-in for SB
      expect(result.posts.get(3)).toBe(10); // BB
    });
  });

  describe("calculateBringIn", () => {
    it("returns bring-in for lowest visible card in stud", () => {
      const players = [
        { fid: 1, seatIndex: 0, visibleCards: ["3c"] },
        { fid: 2, seatIndex: 1, visibleCards: ["2d"] },
        { fid: 3, seatIndex: 2, visibleCards: ["Ah"] },
      ];
      const result = calculateBringIn(getGameConfig("STUD"), players, 10);
      // Ace is lowest in stud
      expect(result.bringInFid).toBe(3);
      // bringIn = 0.5 * smallBet = 0.5 * 10 = 5
      expect(result.amount).toBe(5);
    });

    it("returns null for non-stud variants", () => {
      const players = [
        { fid: 1, seatIndex: 0, visibleCards: ["Ah"] },
      ];
      const result = calculateBringIn(getGameConfig("NLHE"), players, 10);
      expect(result.bringInFid).toBeNull();
      expect(result.amount).toBe(0);
    });
  });

  describe("betting limits", () => {
    it("getMinBet for NLHE is always BB", () => {
      expect(getMinBet(getGameConfig("NLHE"), 10, "preflop")).toBe(10);
      expect(getMinBet(getGameConfig("NLHE"), 10, "river")).toBe(10);
    });

    it("getMinBet for STUD uses small bet / big bet", () => {
      expect(getMinBet(getGameConfig("STUD"), 10, "3rd")).toBe(10); // small bet
      expect(getMinBet(getGameConfig("STUD"), 10, "5th")).toBe(20); // big bet
      expect(getMinBet(getGameConfig("STUD"), 10, "7th")).toBe(20); // big bet
    });

    it("getMaxBet for NL is stack size", () => {
      expect(getMaxBet(getGameConfig("NLHE"), 100, 20, 500, 10)).toBe(510); // stack + toCall
    });

    it("getMaxBet for PL is pot-size raise", () => {
      // pot after call = 100 + 10 = 110, max raise = 110 + 20 = 130, but capped by stack
      expect(getMaxBet(getGameConfig("PLO"), 100, 20, 500, 10)).toBe(130);
    });

    it("getMaxBet for FL is same as min", () => {
      const result = getMaxBet(getGameConfig("STUD"), 100, 20, 500, 10);
      expect(result).toBe(getMinBet(getGameConfig("STUD"), 0, ""));
    });
  });

  describe("hand utilities", () => {
    it("parseHand splits comma-separated cards", () => {
      expect(parseHand("Ah,Kd,Qs")).toEqual(["Ah", "Kd", "Qs"]);
      expect(parseHand("")).toEqual([]);
    });

    it("buildHand joins cards with commas", () => {
      expect(buildHand(["Ah", "Kd"])).toBe("Ah,Kd");
    });

    it("addCardToHand appends a card", () => {
      expect(addCardToHand("Ah,Kd", "Qs")).toBe("Ah,Kd,Qs");
    });

    it("addVisibleCard appends to visible cards", () => {
      expect(addVisibleCard("Ah", "Kd")).toBe("Ah,Kd");
    });
  });
});
