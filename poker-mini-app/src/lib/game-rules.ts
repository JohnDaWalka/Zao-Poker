import {
  Card,
  bestHandRank,
  compareHandRanks,
} from "./poker-hand-evaluator";

export type GameVariant = "NLHE" | "PLO" | "O8B" | "STUD" | "STUD8";
export type BettingLimit = "NL" | "PL" | "FL" | "FL-stud";
export type ShowdownType = "high" | "high-low";
export type ForcedBet = "blinds" | "ante-bringin";

export interface Street {
  name: string;
  phase: string;
  boardCards: number;
  playerCards: number;
  faceUp?: boolean;
  isBigBet?: boolean;
}

export interface GameConfig {
  variant: GameVariant;
  holeCardCount: number;
  streets: Street[];
  bettingLimit: BettingLimit;
  showdownType: ShowdownType;
  forcedBet: ForcedBet;
  minPlayers: number;
  maxPlayers: number;
  smallBetMul?: number;
  bigBetMul?: number;
  anteMul?: number;
  bringInMul?: number;
}

const RANK_STUD_ORDER: Record<string, number> = {
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13,
};
const SUIT_ORDER: Record<string, number> = { c: 1, d: 2, h: 3, s: 4 };

function cardRankStud(card: Card): number {
  return RANK_STUD_ORDER[card[0]] ?? 99;
}
function cardSuitOrder(card: Card): number {
  return SUIT_ORDER[card[1]] ?? 0;
}

export const GAME_CONFIGS: Record<GameVariant, GameConfig> = {
  NLHE: {
    variant: "NLHE",
    holeCardCount: 2,
    streets: [
      { name: "Preflop", phase: "preflop", boardCards: 0, playerCards: 0 },
      { name: "Flop", phase: "flop", boardCards: 3, playerCards: 0 },
      { name: "Turn", phase: "turn", boardCards: 1, playerCards: 0 },
      { name: "River", phase: "river", boardCards: 1, playerCards: 0 },
      { name: "Showdown", phase: "showdown", boardCards: 0, playerCards: 0 },
    ],
    bettingLimit: "NL",
    showdownType: "high",
    forcedBet: "blinds",
    minPlayers: 2,
    maxPlayers: 9,
  },
  PLO: {
    variant: "PLO",
    holeCardCount: 4,
    streets: [
      { name: "Preflop", phase: "preflop", boardCards: 0, playerCards: 0 },
      { name: "Flop", phase: "flop", boardCards: 3, playerCards: 0 },
      { name: "Turn", phase: "turn", boardCards: 1, playerCards: 0 },
      { name: "River", phase: "river", boardCards: 1, playerCards: 0 },
      { name: "Showdown", phase: "showdown", boardCards: 0, playerCards: 0 },
    ],
    bettingLimit: "PL",
    showdownType: "high",
    forcedBet: "blinds",
    minPlayers: 2,
    maxPlayers: 9,
  },
  O8B: {
    variant: "O8B",
    holeCardCount: 4,
    streets: [
      { name: "Preflop", phase: "preflop", boardCards: 0, playerCards: 0 },
      { name: "Flop", phase: "flop", boardCards: 3, playerCards: 0 },
      { name: "Turn", phase: "turn", boardCards: 1, playerCards: 0 },
      { name: "River", phase: "river", boardCards: 1, playerCards: 0 },
      { name: "Showdown", phase: "showdown", boardCards: 0, playerCards: 0 },
    ],
    bettingLimit: "PL",
    showdownType: "high-low",
    forcedBet: "blinds",
    minPlayers: 2,
    maxPlayers: 9,
  },
  STUD: {
    variant: "STUD",
    holeCardCount: 7,
    streets: [
      { name: "3rd Street", phase: "3rd", boardCards: 0, playerCards: 3, faceUp: false },
      { name: "4th Street", phase: "4th", boardCards: 0, playerCards: 1, faceUp: true },
      { name: "5th Street", phase: "5th", boardCards: 0, playerCards: 1, faceUp: true, isBigBet: true },
      { name: "6th Street", phase: "6th", boardCards: 0, playerCards: 1, faceUp: true, isBigBet: true },
      { name: "7th Street", phase: "7th", boardCards: 0, playerCards: 1, faceUp: false, isBigBet: true },
      { name: "Showdown", phase: "showdown", boardCards: 0, playerCards: 0 },
    ],
    bettingLimit: "FL-stud",
    showdownType: "high",
    forcedBet: "ante-bringin",
    minPlayers: 2,
    maxPlayers: 8,
    smallBetMul: 1,
    bigBetMul: 2,
    anteMul: 0.25,
    bringInMul: 0.5,
  },
  STUD8: {
    variant: "STUD8",
    holeCardCount: 7,
    streets: [
      { name: "3rd Street", phase: "3rd", boardCards: 0, playerCards: 3, faceUp: false },
      { name: "4th Street", phase: "4th", boardCards: 0, playerCards: 1, faceUp: true },
      { name: "5th Street", phase: "5th", boardCards: 0, playerCards: 1, faceUp: true, isBigBet: true },
      { name: "6th Street", phase: "6th", boardCards: 0, playerCards: 1, faceUp: true, isBigBet: true },
      { name: "7th Street", phase: "7th", boardCards: 0, playerCards: 1, faceUp: false, isBigBet: true },
      { name: "Showdown", phase: "showdown", boardCards: 0, playerCards: 0 },
    ],
    bettingLimit: "FL-stud",
    showdownType: "high-low",
    forcedBet: "ante-bringin",
    minPlayers: 2,
    maxPlayers: 8,
    smallBetMul: 1,
    bigBetMul: 2,
    anteMul: 0.25,
    bringInMul: 0.5,
  },
};

export function getGameConfig(variant: GameVariant): GameConfig {
  return GAME_CONFIGS[variant] ?? GAME_CONFIGS.NLHE;
}

export function isValidVariant(v: string): v is GameVariant {
  return v in GAME_CONFIGS;
}

export function getStreet(config: GameConfig, phase: string): Street | undefined {
  return config.streets.find((s) => s.phase === phase);
}

export function getNextStreet(config: GameConfig, phase: string): Street | null {
  const idx = config.streets.findIndex((s) => s.phase === phase);
  if (idx === -1 || idx >= config.streets.length - 1) return null;
  return config.streets[idx + 1];
}

function getPreviousStreet(config: GameConfig, phase: string): Street | null {
  const idx = config.streets.findIndex((s) => s.phase === phase);
  if (idx <= 0) return null;
  return config.streets[idx - 1];
}

export function usesBoard(config: GameConfig): boolean {
  return config.streets.some((s) => s.boardCards > 0);
}

export function usesBlinds(config: GameConfig): boolean {
  return config.forcedBet === "blinds";
}

export function usesAnteBringIn(config: GameConfig): boolean {
  return config.forcedBet === "ante-bringin";
}

/* ──────────────────── FIRST-TO-ACT ──────────────────── */

export interface PlayerForActing {
  fid: number;
  seatIndex: number;
  hand: Card[];
  visibleCards: Card[];
  status: string;
}

export function findLowestVisibleCard(players: PlayerForActing[]): PlayerForActing | null {
  if (players.length === 0) return null;
  let lowest: PlayerForActing | null = null;
  let lowestRank = 99;
  let lowestSuit = 99;

  for (const p of players) {
    if (p.visibleCards.length === 0) continue;
    const card = p.visibleCards[0]; // First visible card (3rd-street up card) determines bring-in
    const r = cardRankStud(card);
    const s = cardSuitOrder(card);
    if (r < lowestRank || (r === lowestRank && s < lowestSuit)) {
      lowestRank = r;
      lowestSuit = s;
      lowest = p;
    }
  }
  return lowest;
}

export function findHighestHandShowing(players: PlayerForActing[]): PlayerForActing | null {
  if (players.length === 0) return null;
  let best: PlayerForActing | null = null;
  let bestRank: number[] | null = null;

  for (const p of players) {
    if (p.visibleCards.length === 0) continue;
    const rank = bestHandRank(p.visibleCards, []);
    if (!bestRank || compareHandRanks(rank, bestRank) > 0) {
      bestRank = rank;
      best = p;
    }
  }
  return best;
}

export function getFirstToAct(
  config: GameConfig,
  phase: string,
  players: PlayerForActing[],
  dealerSeatIndex: number
): number | null {
  if (players.length === 0) return null;
  const active = players.filter((p) => p.status === "playing").sort((a, b) => a.seatIndex - b.seatIndex);
  if (active.length === 0) return null;

  switch (config.variant) {
    case "NLHE":
    case "PLO":
    case "O8B": {
      if (phase === "preflop") {
        if (active.length === 2) {
          const dealerPlayer = active.find((p) => p.seatIndex === dealerSeatIndex);
          return dealerPlayer ? dealerPlayer.fid : active[0].fid;
        }
        // 3+ players: UTG is 3 seats after dealer (SB=+1, BB=+2, UTG=+3)
        const dealerPos = active.findIndex((p) => p.seatIndex === dealerSeatIndex);
        const startPos = dealerPos === -1 ? 0 : dealerPos;
        const utgPos = (startPos + 3) % active.length;
        return active[utgPos].fid;
      }
      // Postflop: first to act is player after dealer (SB position)
      const dealerPos = active.findIndex((p) => p.seatIndex === dealerSeatIndex);
      const startPos = dealerPos === -1 ? 0 : dealerPos;
      const firstPos = (startPos + 1) % active.length;
      return active[firstPos].fid;
    }
    case "STUD":
    case "STUD8": {
      if (phase === "3rd") {
        return findLowestVisibleCard(active)?.fid ?? active[0].fid;
      }
      return findHighestHandShowing(active)?.fid ?? active[0].fid;
    }
    default:
      return active[0].fid;
  }
}

/* ──────────────────── FORCED BETS ──────────────────── */

export interface ForcedBetResult {
  posts: Map<number, number>;
  firstToActFid: number | null;
  lastAggressorFid: number | null;
}

export function calculateForcedBets(
  config: GameConfig,
  players: { fid: number; seatIndex: number; stack: number }[],
  dealerSeatIndex: number,
  blinds: { sb: number; bb: number; ante: number }
): ForcedBetResult {
  const posts = new Map<number, number>();
  let firstToActFid: number | null = null;
  let lastAggressorFid: number | null = null;

  players.sort((a, b) => a.seatIndex - b.seatIndex);

  if (usesBlinds(config)) {
    const n = players.length;
    const dealerIdx = players.findIndex((p) => p.seatIndex === dealerSeatIndex);
    const effectiveDealer = dealerIdx === -1 ? 0 : dealerIdx;
    const sbIdx = (effectiveDealer + 1) % n;
    const bbIdx = (effectiveDealer + 2) % n;
    const sbFid = players[sbIdx].fid;
    const bbFid = players[bbIdx].fid;

    if (blinds.ante > 0) {
      for (const p of players) {
        posts.set(p.fid, (posts.get(p.fid) || 0) + Math.min(p.stack, blinds.ante));
      }
    }
    posts.set(sbFid, (posts.get(sbFid) || 0) + Math.min(players[sbIdx].stack, blinds.sb));
    posts.set(bbFid, (posts.get(bbFid) || 0) + Math.min(players[bbIdx].stack, blinds.bb));
    const firstIdx = n === 2 ? sbIdx : (bbIdx + 1) % n;
    firstToActFid = players[firstIdx].fid;
    lastAggressorFid = bbFid;
  } else if (usesAnteBringIn(config)) {
    const bb = blinds.bb;
    const ante = config.anteMul ? Math.floor(bb * config.anteMul) : 0;
    for (const p of players) {
      posts.set(p.fid, (posts.get(p.fid) || 0) + Math.min(p.stack, ante));
    }
  }

  return { posts, firstToActFid, lastAggressorFid };
}

export function calculateBringIn(
  config: GameConfig,
  players: { fid: number; seatIndex: number; visibleCards: Card[] }[],
  bb: number
): { bringInFid: number | null; amount: number } {
  if (!usesAnteBringIn(config)) return { bringInFid: null, amount: 0 };
  const lowest = findLowestVisibleCard(
    players.map((p) => ({
      fid: p.fid,
      seatIndex: p.seatIndex,
      hand: p.visibleCards,
      visibleCards: p.visibleCards,
      status: "playing",
    }))
  );
  const smallBet = bb * (config.smallBetMul ?? 1);
  const amount = config.bringInMul ? Math.floor(smallBet * config.bringInMul) : 0;
  return { bringInFid: lowest?.fid ?? null, amount };
}

/* ──────────────────── BETTING LIMITS ──────────────────── */

function getMinBet(config: GameConfig, bb: number, phase: string): number {
  switch (config.bettingLimit) {
    case "NL":
    case "PL":
      return bb;
    case "FL":
      return bb;
    case "FL-stud": {
      const street = getStreet(config, phase);
      return bb * (street?.isBigBet ? (config.bigBetMul ?? 2) : (config.smallBetMul ?? 1));
    }
    default:
      return bb;
  }
}

function getMaxBet(config: GameConfig, potSize: number, currentBet: number, playerStack: number, toCall: number, bb: number, phase: string): number {
  switch (config.bettingLimit) {
    case "NL":
      return playerStack + toCall;
    case "PL": {
      const potAfterCall = potSize + toCall;
      const maxRaise = potAfterCall + currentBet;
      return Math.min(playerStack + toCall, maxRaise);
    }
    case "FL":
    case "FL-stud":
      return getMinBet(config, bb, phase);
    default:
      return playerStack + toCall;
  }
}

/* ──────────────────── UTILS ──────────────────── */

function parseHand(handStr: string): Card[] {
  return handStr.split(",").map((c) => c.trim()).filter(Boolean);
}

function parseVisibleCards(visStr: string): Card[] {
  return visStr.split(",").map((c) => c.trim()).filter(Boolean);
}

function buildHand(cards: Card[]): string {
  return cards.join(",");
}

function addCardToHand(handStr: string, card: Card): string {
  const existing = parseHand(handStr);
  existing.push(card);
  return buildHand(existing);
}

function addVisibleCard(visStr: string, card: Card): string {
  const existing = parseVisibleCards(visStr);
  existing.push(card);
  return buildHand(existing);
}
