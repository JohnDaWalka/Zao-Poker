/**
 * Pre-flop hand buckets. 169 combos -> ~20 buckets.
 * Used for CFR state reduction.
 */
export function preflopBucket(hand: [string, string]): number {
  const [c1, c2] = hand.sort(); // normalize
  const r1 = c1[0];
  const r2 = c2[0];
  const suited = c1[1] === c2[1];
  
  // Tier 1: Premium
  if ((r1 === 'A' && r2 === 'A') || (r1 === 'K' && r2 === 'K')) return 0;
  if (r1 === 'A' && r2 === 'K' && suited) return 1;
  if ((r1 === 'Q' && r2 === 'Q') || (r1 === 'J' && r2 === 'J')) return 2;
  
  // Tier 2: Strong
  if (r1 === 'A' && r2 === 'K' && !suited) return 3;
  if (r1 === 'A' && ['Q', 'J', 'T'].includes(r2) && suited) return 4;
  if (r1 === 'K' && ['Q', 'J'].includes(r2) && suited) return 5;
  
  // Tier 3: Playable
  if (r1 === 'A' && ['Q', 'J', 'T'].includes(r2) && !suited) return 6;
  if (r1 === 'A' && ['9', '8', '7', '6', '5', '4', '3', '2'].includes(r2) && suited) return 7;
  if (r1 === r2 && ['T', '9', '8', '7'].includes(r1)) return 8;
  
  // Tier 4: Marginal
  if (r1 === 'K' && ['Q', 'J', 'T', '9', '8'].includes(r2) && !suited) return 9;
  if (r1 === 'Q' && ['J', 'T', '9'].includes(r2) && suited) return 10;
  if (r1 === 'J' && ['T', '9'].includes(r2) && suited) return 11;
  
  // Tier 5: Speculative
  if (r1 === r2 && ['6', '5', '4', '3', '2'].includes(r1)) return 12;
  if (['T', '9', '8', '7', '6', '5'].includes(r1) && ['9', '8', '7', '6', '5', '4'].includes(r2) && suited) return 13;
  
  // Tier 6: Trash
  return 14;
}

/**
 * Post-flop equity bucketing.
 * Run a Monte Carlo simulation against random hands to get equity %,
 * then bucket into 10% increments.
 */
export function equityBucket(equityPercent: number): number {
  return Math.min(9, Math.floor(equityPercent / 10));
}

/**
 * Get a human-readable label for a preflop bucket.
 */
export function preflopBucketLabel(bucket: number): string {
  const labels = [
    'Premium (AA/KK)', 'Premium Suited (AKs)', 'Strong Pairs (QQ/JJ)',
    'Strong (AKo)', 'Strong Suited (AQs-AJs)', 'Strong Suited (KQs/KJs)',
    'Playable (AQo-AJo)', 'Suited Aces (A9s-A2s)', 'Mid Pairs (TT-77)',
    'Marginal (KQo-K8o)', 'Suited Connectors (QJs-Q9s)', 'Suited Connectors (JTs-J9s)',
    'Small Pairs (66-22)', 'Suited Connectors (T5s-54s)', 'Trash',
  ];
  return labels[bucket] ?? 'Unknown';
}
