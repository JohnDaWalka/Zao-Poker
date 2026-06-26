import {
  bestHandRank,
  compareHandRanks,
  type Card,
} from "~/lib/poker-hand-evaluator";

export type SolverAction = "fold" | "call" | "raise" | "check" | "bet";

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
};

export type MonteCarloResult = {
  equity: number;
  winRate: number;
  tieRate: number;
  trials: number;
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

export function runMonteCarloEquity(spot: SolverSpot): MonteCarloResult {
  const heroCards = spot.holeCards.map(normalizeCard);
  const boardCards = (spot.boardCards ?? []).map(normalizeCard);
  const opponentCount = Math.max(1, Math.floor(spot.opponentCount ?? 1));
  const trials = Math.max(150, Math.floor(spot.trials ?? 500));
  const deadCards = new Set([...heroCards, ...boardCards]);
  const deck = FULL_DECK.filter((card) => !deadCards.has(card));

  let wins = 0;
  let ties = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    const drawn = sampleWithoutReplacement(
      deck,
      opponentCount * 2 + Math.max(0, 5 - boardCards.length),
    );
    let offset = 0;
    const opponents = Array.from({ length: opponentCount }, () => {
      const hand = drawn.slice(offset, offset + 2);
      offset += 2;
      return hand;
    });
    const completedBoard = [
      ...boardCards,
      ...drawn.slice(offset, offset + Math.max(0, 5 - boardCards.length)),
    ];

    const heroRank = bestHandRank(heroCards, completedBoard);
    const opponentRanks = opponents.map((hand) => bestHandRank(hand, completedBoard));
    const comparisons = opponentRanks.map((rank) => compareHandRanks(heroRank, rank));

    if (comparisons.every((comparison) => comparison > 0)) {
      wins += 1;
    } else if (comparisons.every((comparison) => comparison >= 0)) {
      ties += 1;
    }
  }

  return {
    equity: (wins + ties * 0.5) / trials,
    winRate: wins / trials,
    tieRate: ties / trials,
    trials,
  };
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

function createInfoSet(spot: SolverSpot, equity: number) {
  const street = detectStreet(spot.boardCards ?? []);
  const strength = bucketHandStrength(equity);
  const pressure = bucketPressure(spot.toCall, spot.potSize);
  const spr = bucketSpr(spot.stackSize, spot.potSize);
  const position = spot.position ?? "unknown";
  return `${street}|${strength}|${pressure}|${spr}|${position}`;
}

function estimateFoldEquity(
  spot: SolverSpot,
  action: SolverAction,
  equity: number,
  noise: number,
) {
  if (action !== "bet" && action !== "raise") {
    return 0;
  }

  const pressure = spot.potSize <= 0 ? 0 : spot.toCall / Math.max(spot.potSize, 1);
  const base =
    0.18 +
    (equity - 0.5) * 0.28 +
    (action === "raise" ? 0.08 : 0.03) -
    pressure * 0.12 +
    noise;

  return clamp(base, 0.05, 0.68);
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

function computeActionEv(
  spot: SolverSpot,
  action: SolverAction,
  equity: number,
  noise: number,
) {
  const street = detectStreet(spot.boardCards ?? []);
  const realization =
    street === "preflop" ? 0.79 : street === "flop" ? 0.88 : street === "turn" ? 0.94 : 1;

  if (action === "fold") {
    return 0;
  }

  if (action === "check") {
    return equity * spot.potSize * realization;
  }

  if (action === "call") {
    const showdownPot = spot.potSize + spot.toCall;
    return equity * showdownPot * realization - spot.toCall;
  }

  const aggressiveSize = estimateAggressiveSizing(spot, action);
  const foldEquity = estimateFoldEquity(spot, action, equity, noise);
  const calledEdge =
    equity * (spot.potSize + aggressiveSize) * (realization + 0.04) -
    (1 - equity) * aggressiveSize;

  return foldEquity * spot.potSize + (1 - foldEquity) * calledEdge;
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

export function analyzeHoldemSpot(spot: SolverSpot): SolverAnalysis {
  const monteCarlo = runMonteCarloEquity(spot);
  const actions = chooseActions(spot);
  const infoSet = createInfoSet(spot, monteCarlo.equity);
  const regrets = emptyActionMap(actions);
  const strategySum = emptyActionMap(actions);
  const actionEvs = emptyActionMap(actions);
  const iterations = Math.max(150, Math.floor(spot.iterations ?? 350));

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
      const noise = (Math.random() - 0.5) * 0.14;
      sampledUtilities[action] = computeActionEv(spot, action, monteCarlo.equity, noise);
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
    spot.toCall > 0 ? spot.toCall / Math.max(spot.potSize + spot.toCall, 1) : 0;

  const recommendations = actions
    .filter((action) => strategySum[action] >= 0.05)
    .sort((left, right) => strategySum[right] - strategySum[left])
    .map((action) => ({
      action,
      frequency: `${(strategySum[action] * 100).toFixed(1)}%`,
      description:
        action === "fold"
          ? "Preserve stack when equity under-realizes against the current price."
          : action === "call"
            ? "Realize equity at a price the rollout tree can support."
            : action === "check"
              ? "Take the free card and preserve range coverage."
              : action === "bet"
                ? "Leverage initiative and fold equity while denying free realization."
                : "Apply pressure with a solver-weighted aggression mix.",
    }));

  const tags = [
    detectStreet(spot.boardCards ?? []),
    bucketHandStrength(monteCarlo.equity),
    bucketPressure(spot.toCall, spot.potSize),
    bucketSpr(spot.stackSize, spot.potSize),
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
    recommendations,
    tags,
    summary:
      `Monte Carlo rollouts estimate ${(monteCarlo.equity * 100).toFixed(1)}% equity. ` +
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
    confidence: clamp(0.55 + analysis.equity * 0.35 - analysis.exploitability * 0.05, 0.45, 0.96),
    gto: analysis,
  };
}
