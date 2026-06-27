import {
  bestHandRank,
  compareHandRanks,
  type Card,
} from "~/lib/poker-hand-evaluator";

export type SolverAction = "fold" | "call" | "raise" | "check" | "bet";
export type OpponentRangeProfile =
  | "random"
  | "wide_ip"
  | "blind_defend"
  | "aggressive"
  | "pressure_value";

export type SolverSpot = {
  holeCards: Card[];
  boardCards?: Card[];
  potSize: number;
  toCall: number;
  stackSize: number;
  opponentCount?: number;
  position?: string;
  history?: string[];
  iterations?: number;
  trials?: number;
  opponentProfile?: OpponentRangeProfile;
};

export type MonteCarloResult = {
  equity: number;
  winRate: number;
  tieRate: number;
  trials: number;
  opponentRangeProfile: OpponentRangeProfile;
};

export type SolverAnalysis = {
  infoSet: string;
  street: "preflop" | "flop" | "turn" | "river";
  potOdds: number;
  equity: number;
  winRate: number;
  tieRate: number;
  trials: number;
  exploitability: number;
  strategy: Record<SolverAction, number>;
  counterfactualRegret: Record<SolverAction, number>;
  actionEvs: Record<SolverAction, number>;
  recommendedAction: SolverAction;
  opponentRangeProfile: OpponentRangeProfile;
  recommendations: Array<{
    action: SolverAction;
    frequency: string;
    description: string;
  }>;
  tags: string[];
  summary: string;
};

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const FULL_DECK: Card[] = Array.from(RANKS).flatMap((rank) =>
  Array.from(SUITS).map((suit) => `${rank}${suit}`),
);

const PROFILE_HAND_CLASSES: Record<
  Exclude<OpponentRangeProfile, "random">,
  Set<string>
> = {
  wide_ip: new Set([
    "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44", "33", "22",
    "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s",
    "KQs", "KJs", "KTs", "QJs", "QTs", "JTs", "T9s", "98s", "87s", "76s", "65s", "54s",
    "AKo", "AQo", "AJo", "ATo", "KQo", "KJo", "QJo", "JTo",
  ]),
  blind_defend: new Set([
    "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44", "33", "22",
    "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s",
    "KQs", "KJs", "KTs", "K9s", "QJs", "QTs", "Q9s", "JTs", "J9s", "T9s", "98s", "87s",
    "76s", "65s", "54s", "AKo", "AQo", "AJo", "ATo", "A9o", "KQo", "KJo", "QJo", "JTo",
  ]),
  aggressive: new Set([
    "AA", "KK", "QQ", "JJ", "TT", "99", "88",
    "AKs", "AQs", "AJs", "ATs", "KQs", "KJs", "QJs", "JTs", "T9s",
    "AKo", "AQo", "AJo", "KQo",
  ]),
  pressure_value: new Set([
    "AA", "KK", "QQ", "JJ", "TT",
    "AKs", "AQs", "AJs", "KQs", "QJs",
    "AKo", "AQo",
  ]),
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCard(card: string): Card {
  const trimmed = card.trim();
  if (trimmed.length !== 2) {
    throw new Error(`Invalid card "${card}"`);
  }
  return `${trimmed[0].toUpperCase()}${trimmed[1].toLowerCase()}`;
}

function normalizeSpot(rawSpot: SolverSpot): SolverSpot {
  return {
    ...rawSpot,
    holeCards: rawSpot.holeCards.map(normalizeCard),
    boardCards: (rawSpot.boardCards ?? []).map(normalizeCard),
  };
}

function detectStreet(boardCards: Card[]): SolverAnalysis["street"] {
  if (boardCards.length >= 5) return "river";
  if (boardCards.length === 4) return "turn";
  if (boardCards.length === 3) return "flop";
  return "preflop";
}

function chooseActions(spot: SolverSpot): SolverAction[] {
  return spot.toCall > 0 ? ["fold", "call", "raise"] : ["check", "bet"];
}

function sampleWithoutReplacement<T>(items: T[], count: number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy.slice(0, count);
}

function normalizedHistory(history: string[] | undefined) {
  return (history ?? []).map((entry) => entry.toLowerCase());
}

function historyBucket(history: string[] | undefined) {
  const tokens = normalizedHistory(history);
  const aggressiveCount = tokens.filter(
    (entry) => entry.includes("raise") || entry.includes("bet") || entry.includes("all_in"),
  ).length;
  if (aggressiveCount >= 2) return "reraised";
  if (aggressiveCount === 1) return "contested";
  if (tokens.some((entry) => entry.includes("check"))) return "checked";
  return "unopened";
}

function bucketHandStrength(equity: number) {
  if (equity >= 0.7) return "premium";
  if (equity >= 0.57) return "strong";
  if (equity >= 0.44) return "medium";
  return "weak";
}

function bucketPressure(toCall: number, potSize: number) {
  const ratio = potSize <= 0 ? 0 : toCall / potSize;
  if (ratio >= 0.75) return "high-pressure";
  if (ratio >= 0.3) return "medium-pressure";
  return "low-pressure";
}

function bucketSpr(stackSize: number, potSize: number) {
  const spr = potSize <= 0 ? stackSize : stackSize / potSize;
  if (spr <= 2) return "short";
  if (spr <= 6) return "medium";
  return "deep";
}

function inferOpponentRangeProfile(spot: SolverSpot): OpponentRangeProfile {
  if (spot.opponentProfile) {
    return spot.opponentProfile;
  }

  const tokens = normalizedHistory(spot.history);
  const position = (spot.position ?? "").toLowerCase();
  const raiseCount = tokens.filter(
    (entry) => entry.includes("raise") || entry.includes("bet") || entry.includes("all_in"),
  ).length;

  if (tokens.some((entry) => entry.includes("all_in")) || raiseCount >= 2) {
    return "pressure_value";
  }
  if (raiseCount === 1) {
    return "aggressive";
  }
  if (position.includes("ip") || position.includes("btn") || position.includes("dealer")) {
    return "wide_ip";
  }
  if (position.includes("oop") || position.includes("bb") || position.includes("sb")) {
    return "blind_defend";
  }
  return "random";
}

function createInfoSet(
  spot: SolverSpot,
  equity: number,
  opponentRangeProfile: OpponentRangeProfile,
) {
  const street = detectStreet(spot.boardCards ?? []);
  const strength = bucketHandStrength(equity);
  const pressure = bucketPressure(spot.toCall, spot.potSize);
  const spr = bucketSpr(spot.stackSize, spot.potSize);
  const position = (spot.position ?? "unknown").toLowerCase();
  return `${street}|${strength}|${pressure}|${spr}|${position}|${historyBucket(spot.history)}|${opponentRangeProfile}`;
}

function handClass(cards: Card[]) {
  const [first, second] = cards
    .map(normalizeCard)
    .sort((left, right) => RANKS.indexOf(right[0]) - RANKS.indexOf(left[0]));
  if (first[0] === second[0]) {
    return `${first[0]}${second[0]}`;
  }
  return `${first[0]}${second[0]}${first[1] === second[1] ? "s" : "o"}`;
}

function matchesProfile(cards: Card[], profile: OpponentRangeProfile) {
  if (profile === "random") {
    return true;
  }
  return PROFILE_HAND_CLASSES[profile].has(handClass(cards));
}

function sampleOpponentHand(availableDeck: Card[], profile: OpponentRangeProfile) {
  if (availableDeck.length < 2) {
    return { hand: availableDeck.slice(0, 2), remainingDeck: [] };
  }

  for (let attempt = 0; attempt < 72; attempt += 1) {
    const sample = sampleWithoutReplacement(availableDeck, 2);
    if (matchesProfile(sample, profile)) {
      const used = new Set(sample);
      return {
        hand: sample,
        remainingDeck: availableDeck.filter((card) => !used.has(card)),
      };
    }
  }

  const fallback = sampleWithoutReplacement(availableDeck, 2);
  const used = new Set(fallback);
  return {
    hand: fallback,
    remainingDeck: availableDeck.filter((card) => !used.has(card)),
  };
}

function computeHeroShare(heroCards: Card[], opponents: Card[][], boardCards: Card[]) {
  const heroRank = bestHandRank(heroCards, boardCards);
  const opponentRanks = opponents.map((hand) => bestHandRank(hand, boardCards));
  let bestRank = heroRank;
  for (const rank of opponentRanks) {
    if (compareHandRanks(rank, bestRank) > 0) {
      bestRank = rank;
    }
  }

  const heroIsBest = compareHandRanks(heroRank, bestRank) === 0;
  if (!heroIsBest) {
    return 0;
  }

  const tiedOpponents = opponentRanks.filter(
    (rank) => compareHandRanks(rank, bestRank) === 0,
  ).length;
  return 1 / (1 + tiedOpponents);
}

type TrialContext = {
  opponents: Card[][];
  completedBoard: Card[];
  heroShare: number;
  primaryVillainAhead: boolean;
};

function sampleTrialContext(
  spot: SolverSpot,
  opponentRangeProfile: OpponentRangeProfile,
): TrialContext {
  const heroCards = spot.holeCards;
  const boardCards = spot.boardCards ?? [];
  const opponentCount = Math.max(1, Math.floor(spot.opponentCount ?? 1));
  const deadCards = new Set([...heroCards, ...boardCards]);
  let availableDeck = FULL_DECK.filter((card) => !deadCards.has(card));

  const opponents: Card[][] = [];
  for (let index = 0; index < opponentCount; index += 1) {
    const sampled = sampleOpponentHand(availableDeck, opponentRangeProfile);
    opponents.push(sampled.hand);
    availableDeck = sampled.remainingDeck;
  }

  const completedBoard = [
    ...boardCards,
    ...sampleWithoutReplacement(availableDeck, Math.max(0, 5 - boardCards.length)),
  ];
  const heroShare = computeHeroShare(heroCards, opponents, completedBoard);
  const primaryVillainShare = computeHeroShare(opponents[0], [heroCards], completedBoard);

  return {
    opponents,
    completedBoard,
    heroShare,
    primaryVillainAhead: primaryVillainShare > heroShare,
  };
}

function runMonteCarloEquityNormalized(spot: SolverSpot): MonteCarloResult {
  const opponentRangeProfile = inferOpponentRangeProfile(spot);
  const trials = Math.max(180, Math.floor(spot.trials ?? 500));
  let wins = 0;
  let ties = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    const context = sampleTrialContext(spot, opponentRangeProfile);
    if (context.heroShare >= 1) {
      wins += 1;
    } else if (context.heroShare > 0) {
      ties += 1;
    }
  }

  return {
    equity: (wins + ties * 0.5) / trials,
    winRate: wins / trials,
    tieRate: ties / trials,
    trials,
    opponentRangeProfile,
  };
}

export function runMonteCarloEquity(rawSpot: SolverSpot): MonteCarloResult {
  return runMonteCarloEquityNormalized(normalizeSpot(rawSpot));
}

function estimateAggressiveSizing(spot: SolverSpot, action: SolverAction) {
  const potBase = Math.max(spot.potSize, 20);
  if (action === "bet") {
    return Math.min(spot.stackSize, Math.max(20, Math.round(potBase * 0.65)));
  }
  return Math.min(
    spot.stackSize,
    Math.max(spot.toCall * 2.5, Math.round(potBase * 0.85), 30),
  );
}

function baseContinueRate(
  profile: OpponentRangeProfile,
  primaryVillainAhead: boolean,
  aggressiveSize: number,
  potSize: number,
) {
  const profileBase: Record<OpponentRangeProfile, number> = {
    random: 0.48,
    wide_ip: 0.4,
    blind_defend: 0.46,
    aggressive: 0.58,
    pressure_value: 0.68,
  };

  const sizingPressure = aggressiveSize / Math.max(potSize + aggressiveSize, 1);
  const strengthAdjustment = primaryVillainAhead ? 0.18 : -0.14;
  return clamp(profileBase[profile] + strengthAdjustment - sizingPressure * 0.22, 0.08, 0.92);
}

function baseBetFrequency(
  profile: OpponentRangeProfile,
  primaryVillainAhead: boolean,
  street: SolverAnalysis["street"],
) {
  const profileBase: Record<OpponentRangeProfile, number> = {
    random: 0.34,
    wide_ip: 0.41,
    blind_defend: 0.31,
    aggressive: 0.54,
    pressure_value: 0.58,
  };
  const streetAdjustment =
    street === "preflop" ? 0.08 : street === "flop" ? 0.03 : street === "turn" ? -0.02 : -0.05;
  return clamp(
    profileBase[profile] + streetAdjustment + (primaryVillainAhead ? 0.14 : -0.1),
    0.08,
    0.86,
  );
}

function simulateActionTreeEv(
  spot: SolverSpot,
  action: SolverAction,
  opponentRangeProfile: OpponentRangeProfile,
  trials: number,
) {
  const street = detectStreet(spot.boardCards ?? []);
  if (action === "fold") {
    return 0;
  }

  let totalEv = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const context = sampleTrialContext(spot, opponentRangeProfile);
    const heroShare = context.heroShare;

    if (action === "call") {
      const showdownPot = spot.potSize + spot.toCall;
      totalEv += heroShare * showdownPot - spot.toCall;
      continue;
    }

    if (action === "check") {
      const villainBetFreq = baseBetFrequency(
        opponentRangeProfile,
        context.primaryVillainAhead,
        street,
      );
      if (Math.random() < villainBetFreq && street !== "river") {
        const betSize = Math.max(10, Math.round(Math.max(spot.potSize, 20) * 0.45));
        const callThreshold = betSize / Math.max(spot.potSize + betSize, 1);
        if (heroShare >= callThreshold * 0.85) {
          totalEv += heroShare * (spot.potSize + betSize * 2) - betSize;
        }
      } else {
        totalEv += heroShare * spot.potSize;
      }
      continue;
    }

    const aggressiveSize = estimateAggressiveSizing(spot, action);
    const continueRate = baseContinueRate(
      opponentRangeProfile,
      context.primaryVillainAhead,
      aggressiveSize,
      spot.potSize,
    );

    if (Math.random() > continueRate) {
      totalEv += spot.potSize;
      continue;
    }

    const reraiseRate =
      opponentRangeProfile === "aggressive" || opponentRangeProfile === "pressure_value"
        ? clamp((context.primaryVillainAhead ? 0.24 : 0.08) + (street === "preflop" ? 0.06 : 0), 0.04, 0.34)
        : 0.04;

    if (Math.random() < reraiseRate && spot.stackSize > aggressiveSize * 1.5) {
      const additionalPressure = Math.max(20, Math.round(aggressiveSize * 0.75));
      const heroContinues = heroShare >= 0.46;
      if (!heroContinues) {
        totalEv -= aggressiveSize * 0.9;
      } else {
        const finalPot = spot.potSize + aggressiveSize * 2 + additionalPressure;
        totalEv += heroShare * finalPot - (aggressiveSize + additionalPressure * 0.5);
      }
      continue;
    }

    const callerContribution =
      action === "raise"
        ? Math.max(aggressiveSize - spot.toCall, Math.round(aggressiveSize * 0.55))
        : aggressiveSize;
    const finalPot = spot.potSize + aggressiveSize + callerContribution;
    totalEv += heroShare * finalPot - aggressiveSize;
  }

  return totalEv / trials;
}

function emptyActionMap(actions: SolverAction[]) {
  return actions.reduce(
    (accumulator, action) => {
      accumulator[action] = 0;
      return accumulator;
    },
    {} as Record<SolverAction, number>,
  );
}

export function analyzeHoldemSpot(rawSpot: SolverSpot): SolverAnalysis {
  const spot = normalizeSpot(rawSpot);
  const monteCarlo = runMonteCarloEquityNormalized(spot);
  const actions = chooseActions(spot);
  const infoSet = createInfoSet(
    spot,
    monteCarlo.equity,
    monteCarlo.opponentRangeProfile,
  );
  const regrets = emptyActionMap(actions);
  const strategySum = emptyActionMap(actions);
  const actionEvs = emptyActionMap(actions);
  const iterations = Math.max(180, Math.floor(spot.iterations ?? 360));
  const rolloutTrials = Math.max(40, Math.floor((spot.trials ?? 500) / 5));

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const positiveRegrets = actions.map((action) => Math.max(0, regrets[action]));
    const normalizingSum = positiveRegrets.reduce((sum, regret) => sum + regret, 0);
    const strategy = actions.reduce(
      (accumulator, action, index) => {
        accumulator[action] =
          normalizingSum > 0
            ? positiveRegrets[index] / normalizingSum
            : 1 / actions.length;
        strategySum[action] += accumulator[action];
        return accumulator;
      },
      {} as Record<SolverAction, number>,
    );

    const sampledUtilities = emptyActionMap(actions);
    for (const action of actions) {
      sampledUtilities[action] = simulateActionTreeEv(
        spot,
        action,
        monteCarlo.opponentRangeProfile,
        rolloutTrials,
      );
      actionEvs[action] += sampledUtilities[action];
    }

    const nodeUtility = actions.reduce(
      (sum, action) => sum + strategy[action] * sampledUtilities[action],
      0,
    );

    for (const action of actions) {
      regrets[action] = Math.max(0, regrets[action] + sampledUtilities[action] - nodeUtility);
    }
  }

  for (const action of actions) {
    strategySum[action] /= iterations;
    actionEvs[action] /= iterations;
  }

  const bestAction = actions.reduce((best, action) =>
    strategySum[action] > strategySum[best] ? action : best,
  );
  const expectedValue = actions.reduce(
    (sum, action) => sum + strategySum[action] * actionEvs[action],
    0,
  );
  const exploitability = Math.max(
    0,
    Math.max(...actions.map((action) => actionEvs[action])) - expectedValue,
  );
  const potOdds =
    spot.toCall > 0
      ? spot.toCall / Math.max(spot.potSize + spot.toCall, 1)
      : 0;

  const recommendations = actions
    .filter((action) => strategySum[action] >= 0.05)
    .sort((left, right) => strategySum[right] - strategySum[left])
    .map((action) => ({
      action,
      frequency: `${(strategySum[action] * 100).toFixed(1)}%`,
      description:
        action === "fold"
          ? "Preserve stack when the rollout tree under-realizes your equity."
          : action === "call"
            ? "Defend enough to keep the solver mix from over-folding."
            : action === "check"
              ? "Protect your checking range and realize equity efficiently."
              : action === "bet"
                ? "Apply fold equity against the inferred range while denying realization."
                : "Pressure the inferred range with a solver-weighted raise mix.",
    }));

  const tags = [
    detectStreet(spot.boardCards ?? []),
    bucketHandStrength(monteCarlo.equity),
    bucketPressure(spot.toCall, spot.potSize),
    bucketSpr(spot.stackSize, spot.potSize),
    historyBucket(spot.history),
    monteCarlo.opponentRangeProfile,
  ];

  return {
    infoSet,
    street: detectStreet(spot.boardCards ?? []),
    potOdds,
    equity: monteCarlo.equity,
    winRate: monteCarlo.winRate,
    tieRate: monteCarlo.tieRate,
    trials: monteCarlo.trials,
    exploitability,
    strategy: strategySum,
    counterfactualRegret: regrets,
    actionEvs,
    recommendedAction: bestAction,
    opponentRangeProfile: monteCarlo.opponentRangeProfile,
    recommendations,
    tags,
    summary:
      `Monte Carlo tree rollouts estimate ${(monteCarlo.equity * 100).toFixed(1)}% equity ` +
      `versus an inferred ${monteCarlo.opponentRangeProfile} range. ` +
      `The CFR abstraction prefers ${bestAction} with ${(strategySum[bestAction] * 100).toFixed(1)}% frequency ` +
      `from info set ${infoSet}.`,
  };
}

export function buildCoachResponse(
  spot: SolverSpot,
  chosenAction?: string,
): {
  success: true;
  analysis: string;
  tags: string[];
  confidence: number;
  gto: SolverAnalysis;
} {
  const analysis = analyzeHoldemSpot(spot);
  const normalizedChosenAction =
    chosenAction === "all_in"
      ? "raise"
      : chosenAction === "call"
        ? "call"
        : chosenAction === "fold"
          ? "fold"
          : chosenAction === "raise"
            ? "raise"
            : chosenAction === "bet"
              ? "bet"
              : chosenAction === "check"
                ? "check"
                : null;

  const actionFeedback =
    normalizedChosenAction && analysis.strategy[normalizedChosenAction] !== undefined
      ? analysis.strategy[normalizedChosenAction] >= 0.2
        ? `Your ${normalizedChosenAction} stays inside the recommended mix.`
        : `Your ${normalizedChosenAction} is a lower-frequency line than the solver's preferred mix.`
      : "Use the top-frequency action when you want the most robust baseline line.";

  return {
    success: true,
    analysis: `${analysis.summary} ${actionFeedback}`,
    tags: analysis.tags,
    confidence: clamp(
      0.56 + analysis.equity * 0.32 - analysis.exploitability * 0.05,
      0.45,
      0.96,
    ),
    gto: analysis,
  };
}
