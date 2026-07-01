import { GameDb } from './db.js';
import { rankShowdownWinners, Card } from './poker-evaluator.js';

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

export async function resolveShowdown(
  db: GameDb,
  tableId: string,
  potSize: number,
  board: string,
) {
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

  const winnerIndices =
    activePlayers.length > 0
      ? rankShowdownWinners(
          activePlayers.map((p) => ({ holeCards: p.holeCards.split(",").filter(Boolean) as Card[] })),
          boardCards as Card[],
        )
      : [];

  const baseShare = winnerIndices.length > 0 ? Math.floor(potSize / winnerIndices.length) : 0;
  const remainder = winnerIndices.length > 0 ? potSize - baseShare * winnerIndices.length : 0;

  const outcomes: HandOutcome[] = [];

  for (let i = 0; i < activePlayers.length; i++) {
    const player = activePlayers[i];
    const isWinner = winnerIndices.includes(i);
    const amountWon = isWinner ? baseShare + (i === winnerIndices[0] ? remainder : 0) : 0;

    if (amountWon > 0) {
      await db.execute({
        sql: "UPDATE players SET stack_size = stack_size + ? WHERE fid = ? AND table_id = ?",
        args: [amountWon, player.fid, tableId],
      });
    }

    const result: HandOutcome["result"] = isWinner
      ? winnerIndices.length > 1 ? "split" : "win"
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
