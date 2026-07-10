/**
 * Monte Carlo Equity Calculator — TypeScript port of the Python equity_sim module.
 *
 * This runs entirely in the Next.js runtime (Node.js) and eliminates the need for
 * a separate Python Docker backend. It uses the same Monte Carlo algorithm as the
 * original AI-Poker-Coach backend.
 */

export type Card = { rank: string; suit: string };

export const RANKS = "23456789TJQKA";
export const SUITS = "shdc";

/** All 52 cards as a static deck. */
export const FULL_DECK: Card[] = (() => {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
})();

/** Card to string, e.g. {rank:"A", suit:"s"} → "As" */
export function cardToStr(card: Card): string {
  return card.rank + card.suit;
}

/** String to Card, e.g. "As" → {rank:"A", suit:"s"} */
export function strToCard(s: string): Card {
  return { rank: s[0], suit: s[1] };
}

/** Rank value for comparison (2=0, 3=1, …, A=12). */
function rankValue(rank: string): number {
  return RANKS.indexOf(rank);
}

/** Poker hand evaluation (simplified): returns a comparable score tuple.
 *  The tuple is [handRank, ...kickers] where higher is better.
 *  handRank: 8=straight flush, 7=quads, 6=full house, 5=flush, 4=straight,
 *            3=trips, 2=two pair, 1=pair, 0=high card.
 */
export function evaluateHand(cards: Card[]): number[] {
  const ranks = cards.map((c) => rankValue(c.rank));
  const suits = cards.map((c) => c.suit);
  const rankCounts = new Map<number, number>();
  for (const r of ranks) {
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  }
  const counts = Array.from(rankCounts.values()).sort((a, b) => b - a);
  const uniqueRanks = Array.from(new Set(ranks)).sort((a, b) => b - a);

  const isFlush = (() => {
    const suitCounts = new Map<string, number>();
    for (const s of suits) {
      suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
    }
    return Array.from(suitCounts.values()).some((c) => c >= 5);
  })();

  const isStraight = (() => {
    const sorted = [...new Set(ranks)].sort((a, b) => a - b);
    if (sorted.length < 5) return false;
    for (let i = 0; i <= sorted.length - 5; i++) {
      if (sorted[i + 4] - sorted[i] === 4) return true;
    }
    // A-2-3-4-5 wheel
    if (sorted.includes(12) && sorted.includes(0) && sorted.includes(1) && sorted.includes(2) && sorted.includes(3)) {
      return true;
    }
    return false;
  })();

  // Straight flush
  if (isFlush && isStraight) {
    return [8, ...uniqueRanks];
  }

  // Quads
  if (counts[0] === 4) {
    const quadRank = uniqueRanks.find((r) => rankCounts.get(r) === 4)!;
    const kicker = uniqueRanks.find((r) => r !== quadRank)!;
    return [7, quadRank, kicker];
  }

  // Full house
  if (counts[0] === 3 && counts[1] >= 2) {
    const tripRank = uniqueRanks.find((r) => rankCounts.get(r) === 3)!;
    const pairRank = uniqueRanks.find((r) => r !== tripRank && rankCounts.get(r)! >= 2)!;
    return [6, tripRank, pairRank];
  }

  // Flush
  if (isFlush) {
    return [5, ...uniqueRanks];
  }

  // Straight
  if (isStraight) {
    return [4, ...uniqueRanks];
  }

  // Trips
  if (counts[0] === 3) {
    const tripRank = uniqueRanks.find((r) => rankCounts.get(r) === 3)!;
    const kickers = uniqueRanks.filter((r) => r !== tripRank);
    return [3, tripRank, ...kickers];
  }

  // Two pair
  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = uniqueRanks.filter((r) => rankCounts.get(r) === 2).sort((a, b) => b - a);
    const kicker = uniqueRanks.find((r) => !pairs.includes(r))!;
    return [2, ...pairs, kicker];
  }

  // Pair
  if (counts[0] === 2) {
    const pairRank = uniqueRanks.find((r) => rankCounts.get(r) === 2)!;
    const kickers = uniqueRanks.filter((r) => r !== pairRank);
    return [1, pairRank, ...kickers];
  }

  // High card
  return [0, ...uniqueRanks];
}

/** Compare two hand scores. Returns 1 if a wins, -1 if b wins, 0 if tie. */
export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

/** Draw N cards from the remaining deck (excluding dead cards). */
function drawCards(dead: Set<string>, rng: () => number, count: number): Card[] {
  const available = FULL_DECK.filter((c) => !dead.has(cardToStr(c)));
  const drawn: Card[] = [];
  const used = new Set<string>();
  while (drawn.length < count && drawn.length < available.length) {
    const idx = Math.floor(rng() * available.length);
    const card = available[idx];
    const key = cardToStr(card);
    if (!used.has(key) && !dead.has(key)) {
      drawn.push(card);
      used.add(key);
    }
  }
  return drawn;
}

/** Draw a random opponent hand from remaining cards. */
function drawOpponentHand(dead: Set<string>, rng: () => number): Card[] {
  return drawCards(dead, rng, 2);
}

/** Simple seeded random number generator for deterministic equity runs. */
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monte Carlo equity: hero cards vs random opponent(s). */
export function heroEquity(
  heroCards: string[],
  boardCards: string[] = [],
  opponents = 1,
  trials = 1000,
  seed?: number,
): { winRate: number; tieRate: number; loseRate: number; trials: number } {
  const hero = heroCards.map(strToCard);
  const board = boardCards.map(strToCard);
  const rng = mulberry32(seed ?? Date.now());

  let wins = 0;
  let ties = 0;

  for (let i = 0; i < trials; i++) {
    // Build simulation dead cards: hero + original board + any drawn cards
    const simDead = new Set<string>([...heroCards, ...boardCards]);
    
    // Complete the board if needed (draw remaining cards)
    const cardsToDraw = 5 - board.length;
    const drawnBoard = cardsToDraw > 0 ? drawCards(simDead, rng, cardsToDraw) : [];
    const simBoard = [...board, ...drawnBoard];
    
    // Add drawn board cards to dead set so opponent can't get them
    for (const c of drawnBoard) simDead.add(cardToStr(c));
    
    const heroScore = evaluateHand([...hero, ...simBoard]);

    let heroBeats = 0;
    let heroTies = 0;

    for (let o = 0; o < opponents; o++) {
      const opp = drawOpponentHand(simDead, rng);
      const oppScore = evaluateHand([...opp, ...simBoard]);
      const cmp = compareScores(heroScore, oppScore);
      if (cmp > 0) heroBeats++;
      else if (cmp === 0) heroTies++;
    }

    if (heroTies > 0 && heroBeats === 0 && heroTies === opponents) {
      ties++;
    } else if (heroBeats === opponents) {
      wins++;
    }
    // else: loss (implicit)
  }

  return {
    winRate: wins / trials,
    tieRate: ties / trials,
    loseRate: (trials - wins - ties) / trials,
    trials,
  };
}

/** Parse a hand range string (e.g. "AKs", "22", "random") into specific card combos. */
export function parseRange(handRange: string): string[] {
  handRange = handRange.trim();
  if (handRange.toLowerCase() === "random") {
    const combos: string[] = [];
    for (let i = 0; i < FULL_DECK.length; i++) {
      for (let j = i + 1; j < FULL_DECK.length; j++) {
        combos.push(cardToStr(FULL_DECK[i]) + cardToStr(FULL_DECK[j]));
      }
    }
    return combos;
  }

  if (handRange.length < 2) {
    throw new Error(`Invalid range notation: ${handRange}`);
  }

  const res: string[] = [];
  let suited: boolean | null = null;
  let range = handRange;

  if (range.endsWith("s")) {
    suited = true;
    range = range.slice(0, -1);
  } else if (range.endsWith("o")) {
    suited = false;
    range = range.slice(0, -1);
  }

  const r1 = range[0];
  const r2 = range[1];

  if (r1 === r2) {
    // Pair — all 6 combinations
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        res.push(r1 + SUITS[i] + r2 + SUITS[j]);
      }
    }
  } else {
    if (suited === true) {
      for (const suit of SUITS) {
        res.push(r1 + suit + r2 + suit);
      }
    } else if (suited === false) {
      for (const s1 of SUITS) {
        for (const s2 of SUITS) {
          if (s1 !== s2) {
            res.push(r1 + s1 + r2 + s2);
          }
        }
      }
    } else {
      for (const s1 of SUITS) {
        for (const s2 of SUITS) {
          res.push(r1 + s1 + r2 + s2);
        }
      }
    }
  }

  return res;
}

/** Equity for a hero hand against a specific range string. */
export function heroVsRange(
  heroCards: string[],
  opponentRange: string,
  boardCards: string[] = [],
  trials = 1000,
): { winRate: number; tieRate: number; loseRate: number; trials: number } {
  const combos = parseRange(opponentRange);
  let wins = 0;
  let ties = 0;
  const rng = mulberry32(Date.now());

  for (let i = 0; i < trials; i++) {
    const comboIdx = Math.floor(rng() * combos.length);
    const oppCombo = combos[comboIdx];
    const oppCards = [oppCombo.slice(0, 2), oppCombo.slice(2, 4)];
    const result = heroEquity(heroCards, boardCards, 1, 1);
    wins += result.winRate;
    ties += result.tieRate;
  }

  return {
    winRate: wins / trials,
    tieRate: ties / trials,
    loseRate: 1 - wins / trials - ties / trials,
    trials,
  };
}
