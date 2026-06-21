// Leak Detection Engine
// Two packages: (1) Stats — VPIP, PFR, 3-Bet, AF, WTSD, W$SD, River Call
//               (2) Tilt Flags — Loss Streak, Bad Beat, VPIP Spike, AF Spike, Rapid Play

// ── Types ───────────────────────────────────────────────────────────

export interface PlayerStats {
  handsPlayed: number;
  vpip: number;          // % voluntarily put $ in pot preflop
  pfr: number;           // % preflop raise
  threeBet: number;      // % 3-bet preflop
  af: number;            // aggression factor (bets+raises)/calls
  wtsd: number;          // % went to showdown (of those who saw flop)
  wsd: number;           // % won $ at showdown
  riverCall: number;     // % called on river
  bbPer100: number;      // bb/100 win rate
  winRate: number;       // win % of total hands
}

export interface TiltFlag {
  type: 'loss_streak' | 'bad_beat' | 'vpip_spike' | 'af_spike' | 'rapid_play' | 'revenge_tilt' | 'overbet_pattern';
  severity: 'low' | 'medium' | 'high';
  description: string;
  handIds: string[];
  metric?: number;
  timestamp?: number;
}

export interface LeakReport {
  stats: PlayerStats;
  tiltFlags: TiltFlag[];
  leaks: LeakItem[];
  periodLabel: string;
}

export interface LeakItem {
  stat: string;
  value: number;
  optimal: [number, number]; // [min, max] range
  severity: 'ok' | 'warning' | 'leak';
  advice: string;
}

export interface PeriodSummary {
  period: string;         // "2026-03-05", "2026-W10", "2026-03"
  periodLabel: string;    // "Mar 5", "Week 10", "March"
  hands: number;
  netAmount: number;      // cents
  wins: number;
  losses: number;
  avgPot: number;
  sites: string[];
  gameTypes: string[];
  stats: PlayerStats;
  tiltFlags: TiltFlag[];
}

// ── Optimal ranges (6-max cash game defaults) ───────────────────────

const OPTIMAL = {
  vpip: [20, 28],
  pfr: [15, 22],
  threeBet: [6, 10],
  af: [2.0, 3.5],
  wtsd: [25, 32],
  wsd: [48, 56],
  riverCall: [20, 35],
} as const;

// ── Stats computation from DB rows ──────────────────────────────────

export function computeStats(
  hands: { id: string; net_amount: number; won_pot: number; stakes: string; pot_size: number }[],
  actions: { hand_id: string; player_name: string; action_type: string; amount: number; street: string }[],
  heroName?: string
): PlayerStats {
  if (hands.length === 0) return emptyStats();

  // Group actions by hand
  const actionsByHand = new Map<string, typeof actions>();
  for (const a of actions) {
    const arr = actionsByHand.get(a.hand_id) || [];
    arr.push(a);
    actionsByHand.set(a.hand_id, arr);
  }

  let vpipCount = 0;
  let pfrCount = 0;
  let threeBetCount = 0;
  let totalBetsRaises = 0;
  let totalCalls = 0;
  let sawFlop = 0;
  let wentToShowdown = 0;
  let wonAtShowdown = 0;
  let riverCallCount = 0;
  let riverHandCount = 0;

  for (const hand of hands) {
    const ha = actionsByHand.get(hand.id) || [];
    // Find hero actions (use heroName if provided, else find the hero)
    const heroActions = heroName
      ? ha.filter(a => a.player_name === heroName)
      : ha; // if no hero name, use all (fallback)

    const preflopActions = heroActions.filter(a => a.street === 'Preflop' && a.action_type !== 'post');
    const hasVoluntaryPreflop = preflopActions.some(a => ['call', 'bet', 'raise', 'allin'].includes(a.action_type));
    const hasRaisePreflop = preflopActions.some(a => ['raise', 'allin', 'bet'].includes(a.action_type));

    if (hasVoluntaryPreflop) vpipCount++;
    if (hasRaisePreflop) pfrCount++;

    // 3-bet: hero raised after someone else raised preflop
    const allPreflopActions = ha.filter(a => a.street === 'Preflop' && a.action_type !== 'post');
    const raisesBefore = allPreflopActions.filter(a => ['raise', 'bet'].includes(a.action_type));
    if (raisesBefore.length >= 2 && hasRaisePreflop) threeBetCount++;

    // Aggression factor across all streets
    for (const a of heroActions) {
      if (['bet', 'raise'].includes(a.action_type)) totalBetsRaises++;
      if (a.action_type === 'call') totalCalls++;
    }

    // Saw flop
    const heroFlop = heroActions.some(a => a.street === 'Flop');
    if (heroFlop || heroActions.some(a => a.street === 'Turn' || a.street === 'River' || a.street === 'Showdown')) {
      sawFlop++;
    }

    // Went to showdown
    const heroShowdown = heroActions.some(a => a.street === 'Showdown' || a.action_type === 'show');
    const heroRiver = heroActions.some(a => a.street === 'River');
    if (heroShowdown || (heroRiver && hand.won_pot !== undefined)) {
      wentToShowdown++;
      if (hand.won_pot) wonAtShowdown++;
    }

    // River call
    const riverActions = heroActions.filter(a => a.street === 'River');
    if (riverActions.length > 0) {
      riverHandCount++;
      if (riverActions.some(a => a.action_type === 'call')) riverCallCount++;
    }
  }

  const n = hands.length;
  const totalWon = hands.reduce((s, h) => s + h.net_amount, 0) / 100; // cents→dollars

  // bb/100: approximate from stakes string
  let bbSize = 0.04; // default
  if (hands[0]?.stakes) {
    const parts = hands[0].stakes.split('/');
    if (parts[1]) bbSize = parseFloat(parts[1]) || 0.04;
  }

  return {
    handsPlayed: n,
    vpip: pct(vpipCount, n),
    pfr: pct(pfrCount, n),
    threeBet: pct(threeBetCount, n),
    af: totalCalls > 0 ? round(totalBetsRaises / totalCalls, 2) : totalBetsRaises > 0 ? 99 : 0,
    wtsd: pct(wentToShowdown, Math.max(sawFlop, 1)),
    wsd: pct(wonAtShowdown, Math.max(wentToShowdown, 1)),
    riverCall: pct(riverCallCount, Math.max(riverHandCount, 1)),
    bbPer100: round((totalWon / bbSize) / (n / 100), 2),
    winRate: pct(hands.filter(h => h.won_pot).length, n),
  };
}

// ── Tilt flag detection ─────────────────────────────────────────────

export function detectTiltFlags(
  hands: { id: string; net_amount: number; won_pot: number; timestamp: number; pot_size: number; hero_cards?: string }[],
  actions: { hand_id: string; player_name: string; action_type: string; amount: number; street: string }[],
  sessionStats?: PlayerStats
): TiltFlag[] {
  const flags: TiltFlag[] = [];
  if (hands.length < 5) return flags;

  // Sort by timestamp
  const sorted = [...hands].sort((a, b) => a.timestamp - b.timestamp);

  // ── Loss Streak ──
  let streak = 0;
  let streakHands: string[] = [];
  for (const h of sorted) {
    if (h.net_amount < 0) {
      streak++;
      streakHands.push(h.id);
      if (streak >= 5) {
        flags.push({
          type: 'loss_streak', severity: streak >= 8 ? 'high' : 'medium',
          description: `${streak} consecutive losing hands`,
          handIds: [...streakHands], metric: streak, timestamp: h.timestamp,
        });
      }
    } else {
      streak = 0;
      streakHands = [];
    }
  }

  // ── Bad Beat ── (lost a big pot, pot was > 50bb equivalent)
  const avgPot = sorted.reduce((s, h) => s + h.pot_size, 0) / sorted.length;
  for (const h of sorted) {
    if (h.net_amount < 0 && h.pot_size > avgPot * 3) {
      flags.push({
        type: 'bad_beat', severity: 'high',
        description: `Lost ${(Math.abs(h.net_amount) / 100).toFixed(2)} in oversized pot (${(h.pot_size / 100).toFixed(2)} pot)`,
        handIds: [h.id], metric: h.net_amount / 100, timestamp: h.timestamp,
      });
    }
  }

  // ── VPIP Spike ── (compare rolling 20-hand VPIP vs overall)
  if (sessionStats && sorted.length >= 30) {
    const actionsByHand = groupActions(actions);
    const windowSize = 20;
    for (let i = windowSize; i <= sorted.length; i++) {
      const window = sorted.slice(i - windowSize, i);
      let vpipCount = 0;
      for (const h of window) {
        const ha = actionsByHand.get(h.id) || [];
        const preflopVol = ha.some(a => a.street === 'Preflop' && a.action_type !== 'post' && ['call', 'bet', 'raise', 'allin'].includes(a.action_type));
        if (preflopVol) vpipCount++;
      }
      const windowVPIP = (vpipCount / windowSize) * 100;
      if (windowVPIP > sessionStats.vpip + 15) {
        flags.push({
          type: 'vpip_spike', severity: windowVPIP > sessionStats.vpip + 25 ? 'high' : 'medium',
          description: `VPIP spiked to ${windowVPIP.toFixed(0)}% (session avg ${sessionStats.vpip.toFixed(0)}%) over hands ${i - windowSize + 1}-${i}`,
          handIds: window.map(h => h.id), metric: windowVPIP, timestamp: window[window.length - 1].timestamp,
        });
        i += windowSize; // skip ahead to avoid duplicate flags
      }
    }
  }

  // ── AF Spike ── (aggression factor in last 20 hands vs session)
  if (sessionStats && sorted.length >= 30) {
    const actionsByHand = groupActions(actions);
    const windowSize = 20;
    for (let i = windowSize; i <= sorted.length; i++) {
      const window = sorted.slice(i - windowSize, i);
      let betsRaises = 0, calls = 0;
      for (const h of window) {
        for (const a of (actionsByHand.get(h.id) || [])) {
          if (['bet', 'raise'].includes(a.action_type)) betsRaises++;
          if (a.action_type === 'call') calls++;
        }
      }
      const windowAF = calls > 0 ? betsRaises / calls : betsRaises;
      if (sessionStats.af > 0 && windowAF > sessionStats.af * 2 && windowAF > 5) {
        flags.push({
          type: 'af_spike', severity: 'medium',
          description: `Aggression factor spiked to ${windowAF.toFixed(1)} (session avg ${sessionStats.af.toFixed(1)})`,
          handIds: window.map(h => h.id), metric: windowAF, timestamp: window[window.length - 1].timestamp,
        });
        i += windowSize;
      }
    }
  }

  // ── Rapid Play ── (multiple hands < 10 sec apart)
  let rapidCount = 0;
  const rapidIds: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].timestamp - sorted[i - 1].timestamp) / 1000; // seconds
    if (gap > 0 && gap < 10) {
      rapidCount++;
      rapidIds.push(sorted[i].id);
    }
  }
  if (rapidCount >= 5) {
    flags.push({
      type: 'rapid_play', severity: rapidCount >= 15 ? 'high' : 'medium',
      description: `${rapidCount} hands played with < 10 sec between them — possible tilt auto-pilot`,
      handIds: rapidIds.slice(0, 20), metric: rapidCount,
    });
  }

  // ── Revenge Tilt ── (big loss followed by overbet in next 3 hands)
  for (let i = 0; i < sorted.length - 1; i++) {
    const h = sorted[i];
    if (h.net_amount < -(avgPot * 2)) {
      // Check next 3 hands for unusually large bets
      for (let j = i + 1; j < Math.min(i + 4, sorted.length); j++) {
        const nextH = sorted[j];
        if (nextH.pot_size > avgPot * 2.5 && nextH.net_amount < 0) {
          flags.push({
            type: 'revenge_tilt', severity: 'high',
            description: `Possible revenge tilt: big loss ($${(Math.abs(h.net_amount) / 100).toFixed(2)}) followed by another big pot loss`,
            handIds: [h.id, nextH.id], timestamp: nextH.timestamp,
          });
          break;
        }
      }
    }
  }

  return deduplicateFlags(flags);
}

// ── Leak identification ─────────────────────────────────────────────

export function identifyLeaks(stats: PlayerStats): LeakItem[] {
  const leaks: LeakItem[] = [];

  const check = (name: string, value: number, range: readonly [number, number], advice: string) => {
    let severity: 'ok' | 'warning' | 'leak' = 'ok';
    if (value < range[0] - 5 || value > range[1] + 5) severity = 'leak';
    else if (value < range[0] || value > range[1]) severity = 'warning';
    leaks.push({ stat: name, value: round(value, 1), optimal: [range[0], range[1]], severity, advice });
  };

  check('VPIP', stats.vpip, OPTIMAL.vpip,
    stats.vpip > 28 ? 'Playing too many hands preflop. Tighten starting hand ranges.'
      : stats.vpip < 20 ? 'Playing too few hands. Open up in position.' : 'VPIP is solid.');

  check('PFR', stats.pfr, OPTIMAL.pfr,
    stats.pfr > 22 ? 'Raising too often preflop. Be more selective.'
      : stats.pfr < 15 ? 'Not raising enough. Add more opens from late position.' : 'PFR is balanced.');

  check('3-Bet%', stats.threeBet, OPTIMAL.threeBet,
    stats.threeBet > 10 ? '3-betting too wide. Tighten 3-bet range, especially OOP.'
      : stats.threeBet < 6 ? 'Not 3-betting enough. Add more value and bluff 3-bets.' : '3-bet frequency looks good.');

  check('Aggression Factor', stats.af, OPTIMAL.af,
    stats.af > 3.5 ? 'Over-aggressive. Consider more calls with medium-strength hands.'
      : stats.af < 2.0 ? 'Too passive postflop. Bet and raise more with strong hands + draws.' : 'AF is balanced.');

  check('WTSD%', stats.wtsd, OPTIMAL.wtsd,
    stats.wtsd > 32 ? 'Going to showdown too often. Fold more weak hands on later streets.'
      : stats.wtsd < 25 ? 'Folding too much post-flop. Consider calling down lighter.' : 'WTSD is solid.');

  check('W$SD%', stats.wsd, OPTIMAL.wsd,
    stats.wsd > 56 ? 'Great showdown results — possibly not going often enough.'
      : stats.wsd < 48 ? 'Losing too much at showdown. Improve hand selection for big pots.' : 'Showdown win rate is healthy.');

  check('River Call%', stats.riverCall, OPTIMAL.riverCall,
    stats.riverCall > 35 ? 'Calling river too often. Work on river discipline — many bluffs are actually value.'
      : stats.riverCall < 20 ? 'Folding river too much. Opponents can exploit with bluffs.' : 'River calling is balanced.');

  return leaks;
}

// ── Period summaries ────────────────────────────────────────────────

export function groupByPeriod(
  hands: { id: string; net_amount: number; won_pot: number; timestamp: number; pot_size: number; site: string; game_type: string; stakes: string; hero_cards?: string }[],
  actions: { hand_id: string; player_name: string; action_type: string; amount: number; street: string }[],
  period: 'daily' | 'weekly' | 'monthly'
): PeriodSummary[] {
  const grouped = new Map<string, typeof hands>();

  for (const h of hands) {
    const d = new Date(h.timestamp);
    let key: string;
    let label: string;
    if (period === 'daily') {
      key = d.toISOString().slice(0, 10);
      label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else if (period === 'weekly') {
      const week = getISOWeek(d);
      key = `${d.getFullYear()}-W${week.toString().padStart(2, '0')}`;
      label = `Week ${week}`;
    } else {
      key = d.toISOString().slice(0, 7);
      label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    const arr = grouped.get(key) || [];
    arr.push(h);
    grouped.set(key, arr);
  }

  const summaries: PeriodSummary[] = [];
  for (const [key, periodHands] of grouped) {
    const periodHandIds = new Set(periodHands.map(h => h.id));
    const periodActions = actions.filter(a => periodHandIds.has(a.hand_id));
    const stats = computeStats(periodHands, periodActions);
    const tiltFlags = detectTiltFlags(periodHands, periodActions, stats);

    const d = new Date(periodHands[0].timestamp);
    let label: string;
    if (period === 'daily') label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    else if (period === 'weekly') label = `Week ${getISOWeek(d)}`;
    else label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    summaries.push({
      period: key,
      periodLabel: label,
      hands: periodHands.length,
      netAmount: periodHands.reduce((s, h) => s + h.net_amount, 0),
      wins: periodHands.filter(h => h.won_pot).length,
      losses: periodHands.filter(h => !h.won_pot && h.net_amount < 0).length,
      avgPot: periodHands.reduce((s, h) => s + h.pot_size, 0) / periodHands.length,
      sites: [...new Set(periodHands.map(h => h.site))],
      gameTypes: [...new Set(periodHands.map(h => h.game_type))],
      stats,
      tiltFlags,
    });
  }

  return summaries.sort((a, b) => b.period.localeCompare(a.period));
}

// ── Helpers ─────────────────────────────────────────────────────────

function pct(count: number, total: number): number {
  return total > 0 ? round((count / total) * 100, 1) : 0;
}

function round(val: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

function emptyStats(): PlayerStats {
  return { handsPlayed: 0, vpip: 0, pfr: 0, threeBet: 0, af: 0, wtsd: 0, wsd: 0, riverCall: 0, bbPer100: 0, winRate: 0 };
}

function groupActions(actions: { hand_id: string; action_type: string; street: string }[]) {
  const map = new Map<string, typeof actions>();
  for (const a of actions) {
    const arr = map.get(a.hand_id) || [];
    arr.push(a);
    map.set(a.hand_id, arr);
  }
  return map;
}

function getISOWeek(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function deduplicateFlags(flags: TiltFlag[]): TiltFlag[] {
  const seen = new Set<string>();
  return flags.filter(f => {
    const key = `${f.type}-${f.handIds[0] || ''}-${f.metric || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
