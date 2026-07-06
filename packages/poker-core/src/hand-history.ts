import { GameDb } from './db.js';
import {
  rankShowdownWinners,
  rankHighLowShowdown,
  ShowdownPlayer,
  Card,
} from './poker-evaluator.js';
import { getGameConfig, GameVariant } from './game-rules.js';

export type HandOutcome = {
  fid: number;
  username: string;
  holeCards: string;
  result: "win" | "loss" | "split";
  amountWon: number;
  netAmount: number;
};

async function getHandParticipants(db: GameDb, tableId: string) {
  const { rows } = await db.execute({
    sql: "SELECT fid, username, hand, total_invested FROM players WHERE table_id = ? AND hand != ''",
    args: [tableId],
  });
  return rows.map((row: any) => ({
    fid: Number(row.fid),
    username: String(row.username || `User#${row.fid}`),
    holeCards: String(row.hand || ""),
    invested: Number(row.total_invested || 0),
  }));
}

/** Build side pots from each active player's total investment this hand.
 * Returns an array of pots, each with an amount and the list of eligible
 * player fids (those who invested at least the tier). */
export function buildSidePots(activePlayers: { fid: number; invested: number }[]) {
  const eligible = activePlayers.filter((p) => p.invested > 0);
  if (eligible.length === 0) return [];

  const sortedInvestments = Array.from(new Set(eligible.map((p) => p.invested))).sort(
    (a, b) => a - b,
  );
  const pots: { amount: number; eligibleFids: number[] }[] = [];
  let previousTier = 0;

  for (const tier of sortedInvestments) {
    const diff = tier - previousTier;
    if (diff <= 0) continue;

    const tierEligible = eligible.filter((p) => p.invested >= tier);
    pots.push({
      amount: diff * tierEligible.length,
      eligibleFids: tierEligible.map((p) => p.fid),
    });
    previousTier = tier;
  }

  return pots;
}

/** A hand that ended because everyone but one player folded — that player
 * takes the whole pot uncontested. */
export async function resolveFoldWin(
  db: GameDb,
  tableId: string,
  winnerFid: number,
  potSize: number,
  board: string,
  phaseReached: string,
) {
  const participants = await getHandParticipants(db, tableId);

  const outcomes = participants.map((player) => {
    const isWinner = player.fid === winnerFid;
    const amountWon = isWinner ? potSize : 0;
    return {
      fid: player.fid,
      username: player.username,
      holeCards: player.holeCards,
      result: isWinner ? ("win" as const) : ("loss" as const),
      amountWon,
      netAmount: amountWon - player.invested,
    };
  });

  await recordHandOutcome(db, tableId, board, potSize, phaseReached, "fold", outcomes);
}

/** A hand that reached showdown with 2+ players still in.
 *  Game-variant-aware: handles high-only, high-low split, board vs no-board. */
export async function resolveShowdown(
  db: GameDb,
  tableId: string,
  potSize: number,
  board: string,
  variant: GameVariant = "NLHE",
) {
  const config = getGameConfig(variant);
  const { rows: activeRows } = await db.execute({
    sql: "SELECT fid, username, hand, total_invested FROM players WHERE table_id = ? AND status = 'playing' ORDER BY seat_index ASC",
    args: [tableId],
  });
  const { rows: foldedRows } = await db.execute({
    sql: "SELECT fid, username, hand, total_invested FROM players WHERE table_id = ? AND status = 'folded' AND hand != ''",
    args: [tableId],
  });

  const boardCards = board ? board.split(",").filter(Boolean) : [];
  const activePlayers = activeRows.map((row: any) => ({
    fid: Number(row.fid),
    username: String(row.username || `User#${row.fid}`),
    holeCards: String(row.hand || ""),
    invested: Number(row.total_invested || 0),
  }));

  const winnings: Record<number, number> = {};
  for (const player of activePlayers) {
    winnings[player.fid] = 0;
  }

  const pots = buildSidePots(activePlayers);

  if (config.showdownType === "high-low") {
    const showdownPlayers: ShowdownPlayer[] = activePlayers.map((p) => ({
      fid: p.fid,
      username: p.username,
      holeCards: p.holeCards.split(",").filter(Boolean) as Card[],
      invested: p.invested,
    }));

    for (const pot of pots) {
      const eligibleShowdown = showdownPlayers.filter((p) => pot.eligibleFids.includes(p.fid));
      if (eligibleShowdown.length === 0) continue;

      const { highWinners, lowWinners } = rankHighLowShowdown(
        eligibleShowdown,
        boardCards as Card[],
        variant as "O8B" | "STUD8"
      );

      const highShare = Math.floor(pot.amount / 2);
      const lowShare = pot.amount - highShare;

      // Distribute high half
      if (highWinners.length > 0) {
        const highBase = Math.floor(highShare / highWinners.length);
        const highRemainder = highShare - highBase * highWinners.length;
        for (let i = 0; i < highWinners.length; i++) {
          const fid = highWinners[i];
          winnings[fid] = (winnings[fid] || 0) + highBase + (i === 0 ? highRemainder : 0);
        }
      }

      // Distribute low half (if any qualifying low)
      if (lowWinners.length > 0) {
        const lowBase = Math.floor(lowShare / lowWinners.length);
        const lowRemainder = lowShare - lowBase * lowWinners.length;
        for (let i = 0; i < lowWinners.length; i++) {
          const fid = lowWinners[i];
          winnings[fid] = (winnings[fid] || 0) + lowBase + (i === 0 ? lowRemainder : 0);
        }
      } else {
        // No qualifying low: high scoops the low half too
        for (let i = 0; i < highWinners.length; i++) {
          const fid = highWinners[i];
          winnings[fid] = (winnings[fid] || 0) + Math.floor(lowShare / highWinners.length) + (i === 0 ? (lowShare - Math.floor(lowShare / highWinners.length) * highWinners.length) : 0);
        }
      }
    }
  } else {
    // High-only showdown
    for (const pot of pots) {
      const eligiblePlayers = activePlayers.filter((p) => pot.eligibleFids.includes(p.fid));
      if (eligiblePlayers.length === 0) continue;

      const winnerIndices = rankShowdownWinners(
        eligiblePlayers.map((p) => ({ holeCards: p.holeCards.split(",").filter(Boolean) as Card[] })),
        boardCards as Card[],
      );

      if (winnerIndices.length === 0) continue;

      const baseShare = Math.floor(pot.amount / winnerIndices.length);
      const remainder = pot.amount - baseShare * winnerIndices.length;

      for (let i = 0; i < winnerIndices.length; i++) {
        const winner = eligiblePlayers[winnerIndices[i]];
        const extra = i === 0 ? remainder : 0;
        winnings[winner.fid] = (winnings[winner.fid] || 0) + baseShare + extra;
      }
    }
  }

  const outcomes: HandOutcome[] = [];

  for (const player of activePlayers) {
    const amountWon = winnings[player.fid] || 0;

    if (amountWon > 0) {
      await db.execute({
        sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?",
        args: [amountWon, player.fid, tableId],
      });
    }

    const winnerCount = Object.entries(winnings).filter(([_, amount]) => amount > 0).length;
    const isWinner = amountWon > 0;
    const result: HandOutcome["result"] = isWinner
      ? winnerCount > 1 ? "split" : "win"
      : "loss";

    outcomes.push({
      fid: player.fid,
      username: player.username,
      holeCards: player.holeCards,
      result,
      amountWon,
      netAmount: amountWon - player.invested,
    });
  }

  for (const row of foldedRows) {
    const fid = Number(row.fid);
    outcomes.push({
      fid,
      username: String(row.username || `User#${fid}`),
      holeCards: String(row.hand || ""),
      result: "loss" as const,
      amountWon: 0,
      netAmount: -Number(row.total_invested || 0),
    });
  }

  await db.execute({
    sql: "UPDATE tables SET pot_size = 0, current_bet = 0 WHERE id = ?",
    args: [tableId],
  });

  await recordHandOutcome(db, tableId, board, potSize, "showdown", "showdown", outcomes);
}

async function recordHandOutcome(
  db: GameDb,
  tableId: string,
  board: string,
  potSize: number,
  phaseReached: string,
  resolution: "fold" | "showdown",
  outcomes: HandOutcome[],
) {
  for (const outcome of outcomes) {
    await db.execute({
      sql: `INSERT INTO hand_history
              (table_id, fid, username, hole_cards, board, result, net_amount, pot_size, phase_reached, resolution)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        tableId,
        outcome.fid,
        outcome.username,
        outcome.holeCards,
        board,
        outcome.result,
        outcome.netAmount,
        potSize,
        phaseReached,
        resolution,
      ],
    });

    const won = outcome.result !== "loss" ? 1 : 0;

    await db.execute({
      sql: `INSERT INTO player_stats
              (fid, username, pfp_url, hands_played, hands_won, net_winnings, biggest_pot_won, current_streak, best_streak, last_played_at)
            VALUES (?, ?, '', 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(fid) DO UPDATE SET
              username = excluded.username,
              hands_played = hands_played + 1,
              hands_won = hands_won + ?,
              net_winnings = net_winnings + ?,
              biggest_pot_won = MAX(biggest_pot_won, ?),
              current_streak = CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END,
              best_streak = MAX(best_streak, CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END),
              last_played_at = CURRENT_TIMESTAMP`,
      args: [
        outcome.fid,
        outcome.username,
        won,
        outcome.netAmount,
        outcome.amountWon,
        won,
        won,
        won,
        outcome.netAmount,
        outcome.amountWon,
        won,
        won,
      ],
    });
  }
}
