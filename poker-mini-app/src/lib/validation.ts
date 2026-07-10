/**
 * Input validation utilities for API routes.
 */

export function isValidFid(fid: unknown): fid is number {
  return typeof fid === 'number' && fid > 0 && fid < 1000000000;
}

export function isValidTableId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id);
}

export function isValidCard(card: unknown): card is string {
  return typeof card === 'string' && /^[23456789TJQKA][shdc]$/.test(card);
}

export function isValidCardList(cards: unknown): cards is string[] {
  return Array.isArray(cards) && cards.every(isValidCard);
}

export function sanitizeString(input: unknown, maxLength: number = 200): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  // Remove potentially dangerous characters
  return trimmed.replace(/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

export function isValidAction(action: unknown): action is number {
  return typeof action === 'number' && action >= 0 && action <= 4;
}

export function isValidAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && amount >= 0 && amount <= 1000000000;
}

export function isValidGameType(type: unknown): type is string {
  const validTypes = ['NLHE', 'PLO', 'O8B', 'STUD', 'STUD8'];
  return typeof type === 'string' && validTypes.includes(type);
}

export function isValidSeatIndex(seat: unknown): seat is number {
  return typeof seat === 'number' && seat >= 0 && seat <= 8;
}

/**
 * Validate a poker action payload.
 */
export function validateActionPayload(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  sanitized?: {
    gameId: string;
    playerSeat: number;
    selectedAction?: number;
    selectedAmount?: number;
    stateHash?: string;
  };
} {
  const gameId = sanitizeString(body.gameId);
  if (!gameId || !isValidTableId(gameId)) {
    return { valid: false, error: 'Invalid gameId' };
  }

  const playerSeat = body.playerSeat;
  if (!isValidSeatIndex(playerSeat)) {
    return { valid: false, error: 'Invalid playerSeat' };
  }

  const result: any = { gameId, playerSeat: playerSeat as number };

  if (body.selectedAction !== undefined && body.selectedAction !== null) {
    if (!isValidAction(body.selectedAction)) {
      return { valid: false, error: 'Invalid selectedAction' };
    }
    result.selectedAction = body.selectedAction;
  }

  if (body.selectedAmount !== undefined && body.selectedAmount !== null) {
    if (!isValidAmount(body.selectedAmount)) {
      return { valid: false, error: 'Invalid selectedAmount' };
    }
    result.selectedAmount = body.selectedAmount;
  }

  if (body.stateHash) {
    const hash = sanitizeString(body.stateHash, 256);
    if (hash) result.stateHash = hash;
  }

  return { valid: true, sanitized: result };
}
