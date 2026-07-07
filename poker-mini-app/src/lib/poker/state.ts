import { createHash } from 'crypto';

export interface PublicState {
  pot: number;
  communityCards: string[]; // e.g., ['Ah', 'Kd', '7c']
  activeSeat: number;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  actionHistory: string;      // Compressed action string
  lastAggressor: number | null;
  currentBet: number;
  stacks: Record<number, number>; // seat -> stack
}

export interface PrivateState {
  deck: string[];             // Remaining deck (server only)
  holeCards: Record<number, [string, string]>; // seat -> cards
}

/**
 * Information Set = everything a specific player knows.
 * Used for client-side tree rendering and Farcaster payload.
 */
export function buildInfoSet(
  publicState: PublicState,
  playerSeat: number,
  playerHoleCards: [string, string]
): object {
  return {
    p: publicState.pot,
    c: publicState.communityCards.join(''),
    s: publicState.street,
    h: publicState.actionHistory,
    b: publicState.currentBet,
    m: publicState.stacks[playerSeat], // my stack
    cards: playerHoleCards.join(''),
  };
}

/**
 * Cryptographic hash of the information set.
 * Pass this to Farcaster frames. Server verifies on return.
 */
export function hashInfoSet(infoSet: object, serverSecret: string): string {
  const payload = JSON.stringify(infoSet);
  return createHash('sha256')
    .update(payload + serverSecret)
    .digest('hex')
    .slice(0, 32); // 16 bytes hex = 32 chars, compact
}

export function verifyInfoSet(
  infoSet: object,
  hash: string,
  serverSecret: string
): boolean {
  return hash === hashInfoSet(infoSet, serverSecret);
}
