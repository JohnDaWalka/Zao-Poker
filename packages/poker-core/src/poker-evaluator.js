// Standalone 5/6/7-card poker hand evaluator. Cards use this app's
// existing string format (e.g. "Ah", "Td" — rank then lowercase suit).
// No external dependency.
// Supports high hands, low hands (8-or-better), and Omaha-8 / Stud-8 showdowns.
const RANK_VALUES = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
    "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};
const HIGH_CARD_RANK = 0;
export function rankValue(card) {
    return RANK_VALUES[card[0]] ?? 0;
}
export function suitOf(card) {
    return card[1];
}
export function combinations(items, size) {
    if (size === 0)
        return [[]];
    if (items.length < size)
        return [];
    const [first, ...rest] = items;
    const withFirst = combinations(rest, size - 1).map((combo) => [first, ...combo]);
    const withoutFirst = combinations(rest, size);
    return [...withFirst, ...withoutFirst];
}
export function evaluateFiveCardHand(cards) {
    const values = cards.map(rankValue).sort((a, b) => b - a);
    const suits = cards.map(suitOf);
    const isFlush = suits.every((suit) => suit === suits[0]);
    const counts = new Map();
    for (const value of values)
        counts.set(value, (counts.get(value) ?? 0) + 1);
    const groups = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const uniqueDesc = Array.from(new Set(values)).sort((a, b) => b - a);
    let straightHigh = 0;
    for (let i = 0; i <= uniqueDesc.length - 5; i++) {
        if (uniqueDesc[i] - uniqueDesc[i + 4] === 4) {
            straightHigh = uniqueDesc[i];
            break;
        }
    }
    // wheel straight
    if (!straightHigh && uniqueDesc.includes(14) && uniqueDesc.includes(5) && uniqueDesc.includes(4) && uniqueDesc.includes(3) && uniqueDesc.includes(2)) {
        straightHigh = 5;
    }
    const isStraight = straightHigh > 0;
    if (isStraight && isFlush)
        return [8, straightHigh];
    if (groups[0][1] === 4)
        return [7, groups[0][0], groups[1][0]];
    if (groups[0][1] === 3 && groups[1][1] === 2)
        return [6, groups[0][0], groups[1][0]];
    if (isFlush)
        return [5, ...values];
    if (isStraight)
        return [4, straightHigh];
    if (groups[0][1] === 3)
        return [3, groups[0][0], ...groups.slice(1).map(g => g[0])];
    if (groups[0][1] === 2 && groups[1][1] === 2)
        return [2, groups[0][0], groups[1][0], groups[2][0]];
    if (groups[0][1] === 2)
        return [1, groups[0][0], ...groups.slice(1).map(g => g[0])];
    return [0, ...values];
}
export function compareHandRanks(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const av = a[i] ?? 0;
        const bv = b[i] ?? 0;
        if (av !== bv)
            return av - bv;
    }
    return 0;
}
/** Best 5-card hand out of all combinations of hole cards + board. */
export function bestHandRank(holeCards, board) {
    const allCards = [...holeCards, ...board].filter(Boolean);
    if (allCards.length < 5) {
        const values = allCards.map(rankValue).sort((a, b) => b - a);
        return [HIGH_CARD_RANK, ...values];
    }
    let best = null;
    for (const combo of combinations(allCards, 5)) {
        const rank = evaluateFiveCardHand(combo);
        if (!best || compareHandRanks(rank, best) > 0)
            best = rank;
    }
    return best;
}
/** Ranks each player's best hand and returns the indices of the winner(s)
 * (a tie/split pot returns more than one index). */
export function rankShowdownWinners(players, board) {
    const ranks = players.map((player) => bestHandRank(player.holeCards, board));
    let bestRank = ranks[0];
    for (const rank of ranks) {
        if (compareHandRanks(rank, bestRank) > 0)
            bestRank = rank;
    }
    return ranks
        .map((rank, index) => (compareHandRanks(rank, bestRank) === 0 ? index : -1))
        .filter((index) => index !== -1);
}
/* ──────────────────── LOW HAND EVALUATION ──────────────────── */
/** Determine if a 5-card hand qualifies as a low hand (8-or-better, no pairs).
 *  Returns the low hand rank (lower = better; A-2-3-4-5 is best) or null if not qualifying.
 *  Ace counts as 1 for low. */
export function getLowHandRank(cards) {
    if (cards.length < 5)
        return null;
    const values = cards.map(rankValue);
    const unpaired = Array.from(new Set(values));
    if (unpaired.length < 5)
        return null; // must have 5 distinct ranks
    const sorted = unpaired.sort((a, b) => a - b); // ascending
    if (sorted[sorted.length - 1] > 8)
        return null; // 8-or-better (A=14, so 8 is max)
    // Best low is the 5 lowest distinct cards
    const lowFive = sorted.slice(0, 5);
    // Ace should be 1 for low evaluation, but since we already sorted ascending
    // and A=14 is the largest, it won't be in the low set unless it's the only
    // way to get 5 cards. Actually A=14 > 8, so it would fail the 8-or-better check.
    // Wait, A=14 is > 8, so it would fail... but in poker, A counts as 1 for low!
    // We need to treat A as 1 for low evaluation.
    // Re-evaluate with A=1
    const lowValues = cards.map((c) => (c[0] === "A" ? 1 : rankValue(c)));
    const lowUnpaired = Array.from(new Set(lowValues));
    if (lowUnpaired.length < 5)
        return null;
    const lowSorted = lowUnpaired.sort((a, b) => a - b);
    if (lowSorted[lowSorted.length - 1] > 8)
        return null;
    return lowSorted.slice(0, 5);
}
/** Compare low hands: lower lexicographically wins. Returns negative if a < b. */
export function compareLowHandRanks(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const diff = a[i] - b[i];
        if (diff !== 0)
            return diff;
    }
    return a.length - b.length;
}
/** For Omaha-8: must use exactly 2 hole cards + 3 board cards for both high and low. */
export function getBestOmaha8Hand(holeCards, board) {
    const holeCombos = combinations(holeCards, 2);
    const boardCombos = combinations(board, 3);
    let bestHigh = null;
    let bestLow = null;
    for (const h of holeCombos) {
        for (const b of boardCombos) {
            const high = bestHandRank(h, b);
            if (!bestHigh || compareHandRanks(high, bestHigh) > 0) {
                bestHigh = high;
            }
            const all = [...h, ...b];
            const low = getLowHandRank(all);
            if (low) {
                if (!bestLow || compareLowHandRanks(low, bestLow) < 0) {
                    bestLow = low;
                }
            }
        }
    }
    return { high: bestHigh, low: bestLow };
}
/** Rank players for a high-low showdown.
 *  If no qualifying low, lowWinners is empty (high scoops). */
export function rankHighLowShowdown(players, board, variant) {
    const highRanks = [];
    const lowRanks = [];
    for (const p of players) {
        let high;
        let low = null;
        if (variant === "O8B") {
            const result = getBestOmaha8Hand(p.holeCards, board);
            high = result.high;
            low = result.low;
        }
        else {
            // STUD8: best 5 from 7 for high, best 5 from 7 for low
            high = bestHandRank(p.holeCards, []);
            low = getLowHandRank(p.holeCards);
        }
        highRanks.push({ fid: p.fid, rank: high });
        if (low) {
            lowRanks.push({ fid: p.fid, rank: low });
        }
    }
    // Find best high
    let bestHigh = highRanks[0]?.rank;
    for (const h of highRanks) {
        if (compareHandRanks(h.rank, bestHigh) > 0)
            bestHigh = h.rank;
    }
    const highWinners = highRanks
        .filter((h) => compareHandRanks(h.rank, bestHigh) === 0)
        .map((h) => h.fid);
    // Find best low
    let lowWinners = [];
    if (lowRanks.length > 0) {
        let bestLow = lowRanks[0].rank;
        for (const l of lowRanks) {
            if (compareLowHandRanks(l.rank, bestLow) < 0)
                bestLow = l.rank;
        }
        lowWinners = lowRanks
            .filter((l) => compareLowHandRanks(l.rank, bestLow) === 0)
            .map((l) => l.fid);
    }
    return { highWinners, lowWinners };
}
