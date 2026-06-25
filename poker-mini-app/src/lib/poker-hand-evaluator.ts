// Standalone 5/6/7-card Texas Hold'em hand evaluator. Cards use this app's
// existing string format (e.g. "Ah", "Td" — rank then lowercase suit).
// No external dependency: showdowns must resolve deterministically and the
// rest of this codebase already hand-rolls its own poker logic (see
// evaluateAIAction in api/table/route.ts), so this follows the same pattern.

export type Card = string;

const RANK_VALUES: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
  "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

/** [category, tiebreakers...] — compare lexicographically, higher wins.
 * category: 8=straight flush, 7=quads, 6=full house, 5=flush, 4=straight,
 * 3=trips, 2=two pair, 1=pair, 0=high card. */
export type HandRank = number[];

function rankValue(card: Card): number {
  return RANK_VALUES[card[0]] ?? 0;
}

function suitOf(card: Card): string {
  return card[1];
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, size - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

function evaluateFiveCardHand(cards: Card[]): HandRank {
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const isFlush = suits.every((suit) => suit === suits[0]);

  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );

  const uniqueDesc = Array.from(new Set(values)).sort((a, b) => b - a);
  let straightHigh = 0;
  for (let i = 0; i <= uniqueDesc.length - 5; i++) {
    if (uniqueDesc[i] - uniqueDesc[i + 4] === 4) {
      straightHigh = uniqueDesc[i];
      break;
    }
  }
  // Wheel: A-2-3-4-5 plays as a 5-high straight.
  if (!straightHigh && [14, 5, 4, 3, 2].every((v) => uniqueDesc.includes(v))) {
    straightHigh = 5;
  }
  const isStraight = straightHigh > 0;

  if (isStraight && isFlush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) return [6, groups[0][0], groups[1][0]];
  if (isFlush) return [5, ...values];
  if (isStraight) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const [pairHigh, pairLow] = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return [2, pairHigh, pairLow, groups[2][0]];
  }
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  return [0, ...values];
}

export function compareHandRanks(a: HandRank, b: HandRank): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Best 5-card hand out of all combinations of hole cards + board. */
export function bestHandRank(holeCards: Card[], board: Card[]): HandRank {
  const allCards = [...holeCards, ...board].filter(Boolean);
  if (allCards.length < 5) return evaluateFiveCardHand(allCards.slice(0, 5));

  let best: HandRank | null = null;
  for (const combo of combinations(allCards, 5)) {
    const rank = evaluateFiveCardHand(combo);
    if (!best || compareHandRanks(rank, best) > 0) best = rank;
  }
  return best as HandRank;
}

/** Ranks each player's best hand and returns the indices of the winner(s)
 * (a tie/split pot returns more than one index). */
export function rankShowdownWinners(
  players: { holeCards: Card[] }[],
  board: Card[],
): number[] {
  const ranks = players.map((player) => bestHandRank(player.holeCards, board));
  let bestRank = ranks[0];
  for (const rank of ranks) {
    if (compareHandRanks(rank, bestRank) > 0) bestRank = rank;
  }
  return ranks
    .map((rank, index) => (compareHandRanks(rank, bestRank) === 0 ? index : -1))
    .filter((index) => index !== -1);
}
