import { compareHandRanks, bestHandRank, getLowHandRank, compareLowHandRanks, rankHighLowShowdown, rankShowdownWinners, combinations } from "./poker-evaluator.js";
const RANK_STUD_ORDER = {
    A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13,
};
const SUIT_ORDER = { c: 1, d: 2, h: 3, s: 4 };
function cardRankStud(card) {
    return RANK_STUD_ORDER[card[0]] ?? 99;
}
function cardSuitOrder(card) {
    return SUIT_ORDER[card[1]] ?? 0;
}
export const GAME_CONFIGS = {
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
export function getGameConfig(variant) {
    return GAME_CONFIGS[variant] ?? GAME_CONFIGS.NLHE;
}
export function isValidVariant(v) {
    return v in GAME_CONFIGS;
}
export function getStreet(config, phase) {
    return config.streets.find((s) => s.phase === phase);
}
export function getNextStreet(config, phase) {
    const idx = config.streets.findIndex((s) => s.phase === phase);
    if (idx === -1 || idx >= config.streets.length - 1)
        return null;
    return config.streets[idx + 1];
}
export function getPreviousStreet(config, phase) {
    const idx = config.streets.findIndex((s) => s.phase === phase);
    if (idx <= 0)
        return null;
    return config.streets[idx - 1];
}
/** Is this a board-game variant (holdem/omaha) or a stud variant? */
export function usesBoard(config) {
    return config.streets.some((s) => s.boardCards > 0);
}
export function usesBlinds(config) {
    return config.forcedBet === "blinds";
}
export function usesAnteBringIn(config) {
    return config.forcedBet === "ante-bringin";
}
/** How many cards should a player have after dealing a given street? */
export function cardsAfterStreet(config, phase) {
    let count = 0;
    for (const street of config.streets) {
        if (street.phase === phase)
            break;
        count += street.playerCards;
    }
    return count;
}
/** Find the player with the lowest visible card. Used for stud bring-in and 3rd/4th street first actor. */
export function findLowestVisibleCard(players) {
    if (players.length === 0)
        return null;
    let lowest = null;
    let lowestRank = 99;
    let lowestSuit = 99;
    for (const p of players) {
        if (p.visibleCards.length === 0)
            continue;
        const card = p.visibleCards[p.visibleCards.length - 1]; // most recently dealt visible card
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
/** Find the player with the highest visible hand showing (for 5th+ street in stud). */
export function findHighestHandShowing(players) {
    if (players.length === 0)
        return null;
    let best = null;
    let bestRank = null;
    for (const p of players) {
        if (p.visibleCards.length === 0)
            continue;
        const rank = bestHandRank(p.visibleCards, []);
        if (!bestRank || compareHandRanks(rank, bestRank) > 0) {
            bestRank = rank;
            best = p;
        }
    }
    return best;
}
/** Get the FID of the player who should act first on the current street.
 *  Returns null if no valid first actor (e.g. heads-up on a street where
 *  the only player left is already all-in). */
export function getFirstToAct(config, phase, players, dealerSeatIndex) {
    if (players.length === 0)
        return null;
    const active = players.filter((p) => p.status === "playing");
    if (active.length === 0)
        return null;
    // Sort by seat index for consistent ordering
    active.sort((a, b) => a.seatIndex - b.seatIndex);
    switch (config.variant) {
        case "NLHE":
        case "PLO":
        case "O8B": {
            // Postflop: first active player after dealer (SB or button in HU)
            if (phase === "preflop") {
                // First active after BB (or SB in HU)
                // In 3+, BB is 2 after dealer, first actor is 3 after dealer
                // In HU, dealer=SB, other=BB, first actor=SB (dealer)
                if (active.length === 2) {
                    const dealerPlayer = active.find((p) => p.seatIndex === dealerSeatIndex);
                    return dealerPlayer ? dealerPlayer.fid : active[0].fid;
                }
                const startIdx = active.findIndex((p) => p.seatIndex > dealerSeatIndex);
                const bbIdx = (startIdx + 1) % active.length; // first after dealer = SB, next = BB
                const firstAfterBB = (bbIdx + 1) % active.length;
                return active[firstAfterBB].fid;
            }
            const startIdx = active.findIndex((p) => p.seatIndex > dealerSeatIndex);
            const idx = startIdx === -1 ? 0 : startIdx;
            return active[idx].fid;
        }
        case "STUD":
        case "STUD8": {
            // 3rd street: lowest visible card (only 1 card is visible on 3rd)
            if (phase === "3rd") {
                const lowest = findLowestVisibleCard(active);
                return lowest?.fid ?? active[0].fid;
            }
            // 4th street: lowest visible card (2 visible cards now)
            if (phase === "4th") {
                const lowest = findLowestVisibleCard(active);
                return lowest?.fid ?? active[0].fid;
            }
            // 5th-7th street: highest hand showing
            const highest = findHighestHandShowing(active);
            return highest?.fid ?? active[0].fid;
        }
        default:
            return active[0].fid;
    }
}
/** Calculate forced bets for a new hand.
 *  For blinds: SB, BB, ante.
 *  For ante+bring-in: ante from all, bring-in determined after cards are dealt. */
export function calculateForcedBets(config, players, dealerSeatIndex, blinds) {
    const posts = new Map();
    let firstToActFid = null;
    let lastAggressorFid = null;
    players.sort((a, b) => a.seatIndex - b.seatIndex);
    if (usesBlinds(config)) {
        const n = players.length;
        const dealerIdx = players.findIndex((p) => p.seatIndex === dealerSeatIndex);
        const effectiveDealer = dealerIdx === -1 ? 0 : dealerIdx;
        const sbIdx = (effectiveDealer + 1) % n;
        const bbIdx = (effectiveDealer + 2) % n;
        const sbFid = players[sbIdx].fid;
        const bbFid = players[bbIdx].fid;
        // Ante from all
        if (blinds.ante > 0) {
            for (const p of players) {
                posts.set(p.fid, (posts.get(p.fid) || 0) + Math.min(p.stack, blinds.ante));
            }
        }
        // Blinds
        posts.set(sbFid, (posts.get(sbFid) || 0) + Math.min(players[sbIdx].stack, blinds.sb));
        posts.set(bbFid, (posts.get(bbFid) || 0) + Math.min(players[bbIdx].stack, blinds.bb));
        // First to act: UTG (after BB), or SB in HU
        const firstIdx = n === 2 ? sbIdx : (bbIdx + 1) % n;
        firstToActFid = players[firstIdx].fid;
        lastAggressorFid = bbFid;
    }
    else if (usesAnteBringIn(config)) {
        // Stud: ante from all, bring-in determined after cards are dealt
        const bb = blinds.bb;
        const ante = config.anteMul ? Math.floor(bb * config.anteMul) : 0;
        for (const p of players) {
            posts.set(p.fid, (posts.get(p.fid) || 0) + Math.min(p.stack, ante));
        }
        // First to act and bring-in will be determined after cards are dealt
        // The caller must re-calculate bring-in after dealing
    }
    return { posts, firstToActFid, lastAggressorFid };
}
/** After dealing stud 3rd street, determine who must post the bring-in. */
export function calculateBringIn(config, players, bb) {
    if (!usesAnteBringIn(config))
        return { bringInFid: null, amount: 0 };
    const lowest = findLowestVisibleCard(players.map((p) => ({
        fid: p.fid,
        seatIndex: p.seatIndex,
        hand: p.visibleCards,
        visibleCards: p.visibleCards,
        status: "playing",
    })));
    const smallBet = bb * (config.smallBetMul ?? 1);
    const amount = config.bringInMul ? Math.floor(smallBet * config.bringInMul) : 0;
    return { bringInFid: lowest?.fid ?? null, amount };
}
/* ──────────────────── BETTING LIMITS ──────────────────── */
export function getMinBet(config, bb, phase) {
    switch (config.bettingLimit) {
        case "NL":
            return bb; // minimum raise = BB
        case "PL": {
            // Minimum raise = BB, but max = pot size
            return bb;
        }
        case "FL":
            return bb;
        case "FL-stud": {
            const street = getStreet(config, phase);
            if (street?.isBigBet)
                return bb * (config.bigBetMul ?? 2);
            return bb * (config.smallBetMul ?? 1);
        }
        default:
            return bb;
    }
}
export function getMaxBet(config, potSize, currentBet, playerStack, toCall) {
    switch (config.bettingLimit) {
        case "NL":
            return playerStack + toCall; // can bet all-in
        case "PL": {
            // Pot limit: max bet = pot + currentBet + toCall (after calling)
            const potAfterCall = potSize + toCall;
            const maxRaise = potAfterCall + currentBet; // simplified
            return Math.min(playerStack + toCall, maxRaise);
        }
        case "FL":
        case "FL-stud":
            return getMinBet(config, 0, ""); // fixed limit, min = max for a bet
        default:
            return playerStack + toCall;
    }
}
/** Parse a hand string (comma-separated) into card array. */
export function parseHand(handStr) {
    return handStr.split(",").map((c) => c.trim()).filter(Boolean);
}
/** Parse visible cards string. */
export function parseVisibleCards(visStr) {
    return visStr.split(",").map((c) => c.trim()).filter(Boolean);
}
/** Build hand string from cards. */
export function buildHand(cards) {
    return cards.join(",");
}
/** Add a card to a hand string. */
export function addCardToHand(handStr, card) {
    const existing = parseHand(handStr);
    existing.push(card);
    return buildHand(existing);
}
/** Add a visible card to visible_cards string. */
export function addVisibleCard(visStr, card) {
    const existing = parseVisibleCards(visStr);
    existing.push(card);
    return buildHand(existing);
}
export { rankHighLowShowdown, rankShowdownWinners, combinations, getLowHandRank, compareLowHandRanks };
