const ACTION_CHARS: Record<number, string> = {
  0: 'f', // fold
  1: 'c', // check/call
  2: 'h', // half pot
  3: 'p', // full pot
  4: 'a', // all-in
};

const STREET_DELIMS: Record<string, string> = {
  preflop: '/',
  flop: '|',
  turn: ':',
  river: ';',
};

interface EncodedAction {
  seat: number;
  action: number;
  amount: number;
  street: string;
}

/**
 * Encode action history into a compact string.
 * Example: "1/2c1|cp3;1a" 
 * Decodes to: preflop: call, raise-half, call -> flop: check, call, raise-pot -> river: call, all-in
 */
export function encodeActionHistory(
  actions: EncodedAction[],
  currentStreet: string
): string {
  let out = '';
  let lastStreet = 'preflop';
  
  for (const a of actions) {
    if (a.street !== lastStreet) {
      out += STREET_DELIMS[lastStreet];
      lastStreet = a.street;
    }
    out += (a.seat + 1).toString(); // 1-indexed seat
    out += ACTION_CHARS[a.action] || '?';
  }
  out += STREET_DELIMS[lastStreet] ?? STREET_DELIMS[currentStreet];
  
  return out;
}

export function decodeActionHistory(encoded: string): Array<{
  seat: number;
  action: number;
  street: string;
}> {
  const streetMap: Record<string, string> = {
    '/': 'preflop', '|': 'flop', ':': 'turn', ';': 'river',
  };
  
  const actions = [];
  let currentStreet = 'preflop';
  let i = 0;
  
  while (i < encoded.length) {
    const ch = encoded[i];
    if (streetMap[ch]) {
      currentStreet = streetMap[ch];
      i++;
      continue;
    }
    
    const seat = parseInt(ch) - 1;
    i++;
    if (i >= encoded.length) break;
    const actionCode = encoded[i];
    i++;
    
    const actionEntry = Object.entries(ACTION_CHARS).find(([,v]) => v === actionCode);
    const actionType = actionEntry ? parseInt(actionEntry[0]) : 0;
    
    actions.push({
      seat,
      action: actionType,
      street: currentStreet,
    });
  }
  
  return actions;
}

/**
 * Decode action history into a human-readable string for display.
 */
export function formatActionHistory(encoded: string): string {
  const actions = decodeActionHistory(encoded);
  const streetLabels: Record<string, string> = {
    preflop: 'Pre', flop: 'Flop', turn: 'Turn', river: 'River',
  };
  
  const streetGroups: Record<string, string[]> = {};
  for (const a of actions) {
    if (!streetGroups[a.street]) streetGroups[a.street] = [];
    const labels = ['Fold', 'Call', '½Pot', 'Pot', 'AllIn'];
    streetGroups[a.street].push(`S${a.seat + 1}:${labels[a.action] ?? '?'}`);
  }
  
  return Object.entries(streetGroups)
    .map(([street, acts]) => `${streetLabels[street] ?? street}: ${acts.join(' ')}`)
    .join(' → ');
}
