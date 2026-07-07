export const BET_ABSTRACTION = {
  FOLD: 0,
  CHECK_CALL: 1,   // Check if no bet facing, Call if bet facing
  BET_HALF: 2,     // Bet/Raise to 0.5x pot
  BET_FULL: 3,     // Bet/Raise to 1.0x pot
  ALL_IN: 4,       // Push entire stack
} as const;

export type AbstractAction = typeof BET_ABSTRACTION[keyof typeof BET_ABSTRACTION];

export interface ActionEdge {
  type: AbstractAction;
  label: string;
  minAmount: number;
  maxAmount: number;
  isTerminal: boolean; // Fold or all-in call ends the street/tree branch
}

export function getValidActions(
  facingBet: number,        // 0 if checked to
  playerStack: number,
  potSize: number,
  street: 'preflop' | 'flop' | 'turn' | 'river',
  hasActed: boolean         // Has this player already acted this street?
): ActionEdge[] {
  
  const edges: ActionEdge[] = [];
  
  // Always can fold if facing a bet
  if (facingBet > 0) {
    edges.push({
      type: BET_ABSTRACTION.FOLD,
      label: 'Fold',
      minAmount: 0,
      maxAmount: 0,
      isTerminal: true,
    });
  }
  
  // Check (if no bet) or Call (if bet facing)
  const callAmount = Math.min(facingBet, playerStack);
  edges.push({
    type: BET_ABSTRACTION.CHECK_CALL,
    label: facingBet === 0 ? 'Check' : 'Call',
    minAmount: callAmount,
    maxAmount: callAmount,
    isTerminal: callAmount === playerStack, // Call all-in is terminal
  });
  
  // Can't raise if all-in to call
  if (callAmount >= playerStack) return edges;
  
  const toCall = facingBet;
  const basePot = potSize + toCall; // Pot if we call first
  
  // Half pot raise
  const halfPotTarget = basePot * 0.5 + toCall;
  const halfPotRaise = Math.min(halfPotTarget, playerStack);
  if (halfPotRaise > toCall && halfPotRaise < playerStack) {
    edges.push({
      type: BET_ABSTRACTION.BET_HALF,
      label: facingBet === 0 ? 'Bet ½ Pot' : 'Raise ½ Pot',
      minAmount: halfPotRaise,
      maxAmount: halfPotRaise,
      isTerminal: false,
    });
  }
  
  // Full pot raise
  const fullPotTarget = basePot * 1.0 + toCall;
  const fullPotRaise = Math.min(fullPotTarget, playerStack);
  if (fullPotRaise > toCall && fullPotRaise < playerStack) {
    edges.push({
      type: BET_ABSTRACTION.BET_FULL,
      label: facingBet === 0 ? 'Bet Pot' : 'Raise Pot',
      minAmount: fullPotRaise,
      maxAmount: fullPotRaise,
      isTerminal: false,
    });
  }
  
  // All-in (only if not already covered by a size)
  if (playerStack > toCall && playerStack !== halfPotRaise && playerStack !== fullPotRaise) {
    edges.push({
      type: BET_ABSTRACTION.ALL_IN,
      label: 'All In',
      minAmount: playerStack,
      maxAmount: playerStack,
      isTerminal: true,
    });
  }
  
  return edges;
}
