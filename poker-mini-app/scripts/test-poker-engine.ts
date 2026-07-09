// Integration tests for the NLHE poker engine.
// Run with: npx tsx scripts/test-poker-engine.ts

import path from "path";
import os from "os";

// Force a fresh local SQLite database for this test run.
const testDbPath = path.join(os.tmpdir(), `poker_engine_test_${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${testDbPath}`;

import { db, initDb } from "../src/lib/db";
import {
  createDeck,
  getCurrentBlinds,
  isStreetOver,
  getNextActiveIndex,
  dealNewHand,
  advanceGame,
} from "../src/app/api/table/route";
import { rankShowdownWinners } from "../src/lib/poker-hand-evaluator";
import { resolveShowdown, buildSidePots } from "../src/lib/hand-history";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function setupTestTable(
  tableId: string,
  playerConfigs: { fid: number; username: string; stack: number; seat_index: number }[],
  startMinutesAgo = 7,
) {
  const startTime = new Date(Date.now() - startMinutesAgo * 60 * 1000).toISOString();
  await db.execute({
    sql: "INSERT INTO tables (id, name, status, start_time) VALUES (?, ?, 'waiting', ?)",
    args: [tableId, "Test Table", startTime],
  });

  for (const p of playerConfigs) {
    await db.execute({
      sql: "INSERT INTO players (fid, username, table_id, seat_index, stack_size, status, is_ready) VALUES (?, ?, ?, ?, ?, 'waiting', 1)",
      args: [p.fid, p.username, tableId, p.seat_index, p.stack],
    });
  }
}

async function getTable(tableId: string) {
  const { rows } = await db.execute({ sql: "SELECT * FROM tables WHERE id = ?", args: [tableId] });
  return rows[0];
}

async function getPlayers(tableId: string) {
  const { rows } = await db.execute({
    sql: "SELECT * FROM players WHERE table_id = ? ORDER BY seat_index ASC",
    args: [tableId],
  });
  return rows;
}

function getPositions(players: any[], dealerSeatIndex: number) {
  const bySeat = players.sort((a, b) => Number(a.seat_index) - Number(b.seat_index));
  const n = bySeat.length;
  const dealer = bySeat[dealerSeatIndex % n];
  const sb = bySeat[(dealerSeatIndex + 1) % n];
  const bb = bySeat[(dealerSeatIndex + 2) % n];
  const utg = n === 2 ? sb : bySeat[(dealerSeatIndex + 3) % n];
  return { dealer, sb, bb, utg };
}

async function simulateCheck(tableId: string, fid: number, active: any[]) {
  await db.execute({
    sql: "UPDATE players SET has_acted = 1 WHERE fid = ? AND table_id = ?",
    args: [fid, tableId],
  });
}

async function simulateCall(tableId: string, fid: number, tableBet: number) {
  const player = (await getPlayers(tableId)).find((p) => Number(p.fid) === fid);
  if (!player) throw new Error("player not found");
  const currentBet = Number(player.current_bet || 0);
  const stack = Number(player.stack_size || 0);
  const callAmount = Math.min(stack, Math.max(0, tableBet - currentBet));
  const newBet = currentBet + callAmount;
  await db.execute({
    sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = total_invested + ?, has_acted = 1 WHERE fid = ? AND table_id = ?",
    args: [callAmount, newBet, callAmount, fid, tableId],
  });
  await db.execute({
    sql: "UPDATE tables SET pot_size = pot_size + ? WHERE id = ?",
    args: [callAmount, tableId],
  });
}

async function simulateBet(tableId: string, fid: number, amount: number) {
  const player = (await getPlayers(tableId)).find((p) => Number(p.fid) === fid);
  if (!player) throw new Error("player not found");
  const currentBet = Number(player.current_bet || 0);
  const stack = Number(player.stack_size || 0);
  // current_bet only tracks blinds/bets, not antes. The full difference is
  // new money into the pot from this player this street.
  const betDiff = Math.min(stack, Math.max(0, amount - currentBet));
  const newBet = currentBet + betDiff;
  await db.execute({
    sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = total_invested + ?, has_acted = 1 WHERE fid = ? AND table_id = ?",
    args: [betDiff, newBet, betDiff, fid, tableId],
  });
  await db.execute({
    sql: "UPDATE tables SET pot_size = pot_size + ?, current_bet = ?, last_aggressor_fid = ? WHERE id = ?",
    args: [betDiff, newBet, fid, tableId],
  });
  await db.execute({
    sql: "UPDATE players SET has_acted = 0 WHERE table_id = ? AND status = 'playing' AND fid != ?",
    args: [tableId, fid],
  });
}

async function runStreet(tableId: string, actors: number[], action: "check" | "call", tableBet = 0) {
  for (const fid of actors) {
    if (action === "check") {
      await simulateCheck(tableId, fid, []);
    } else {
      await simulateCall(tableId, fid, tableBet);
    }
    const active = (await getPlayers(tableId)).filter((p) => p.status === "playing");
    if (isStreetOver(active, tableBet)) {
      await advanceGame(tableId, await getTable(tableId));
      break;
    }
  }
}

async function runTests() {
  console.log("Initializing test database...");
  await initDb();

  // --- Pure helper tests ---
  console.log("\n--- Pure helper tests ---");

  assert(!isStreetOver([], 0), "empty table is not street over");
  assert(
    isStreetOver(
      [
        { current_bet: 20, has_acted: 1, stack_size: 100 },
        { current_bet: 20, has_acted: 1, stack_size: 100 },
      ],
      20,
    ),
    "two matched players is street over",
  );
  assert(
    !isStreetOver(
      [
        { current_bet: 20, has_acted: 1, stack_size: 100 },
        { current_bet: 10, has_acted: 1, stack_size: 100 },
      ],
      20,
    ),
    "underbet active player is not street over",
  );
  assert(
    isStreetOver(
      [
        { current_bet: 20, has_acted: 1, stack_size: 100 },
        { current_bet: 10, has_acted: 1, stack_size: 0 },
      ],
      20,
    ),
    "all-in for less is treated as complete",
  );
  assert(getNextActiveIndex(0, [1, 2, 3]) === 1, "next index wraps correctly");
  assert(getNextActiveIndex(2, [1, 2, 3]) === 0, "next index wraps from end");

  const deck = createDeck();
  assert(deck.length === 52, "deck has 52 cards");
  assert(new Set(deck).size === 52, "deck has unique cards");

  const blinds = getCurrentBlinds(new Date(Date.now() - 7 * 60 * 1000).toISOString());
  assert(blinds.blinds.sb === 10 && blinds.blinds.bb === 20 && blinds.blinds.ante === 5, "level 1 blinds are 10/20/5");

  // --- Side pot builder tests ---
  console.log("\n--- Side pot builder tests ---");
  const pots1 = buildSidePots([
    { fid: 1, invested: 50 },
    { fid: 2, invested: 100 },
    { fid: 3, invested: 100 },
  ]);
  assert(pots1.length === 2, "two tiers create two side pots");
  assert(pots1[0].amount === 50 * 3, "main pot is short stack * 3");
  assert(pots1[0].eligibleFids.length === 3, "all three eligible for main pot");
  assert(pots1[1].amount === 50 * 2, "side pot is excess * 2");
  assert(pots1[1].eligibleFids.length === 2, "only deep players eligible for side pot");

  // --- Full hand flow: 3 players, checks to showdown ---
  console.log("\n--- 3-player hand: checks to showdown ---");
  const table1 = "test_table_1";
  await setupTestTable(table1, [
    { fid: 100, username: "Alice", stack: 1000, seat_index: 0 },
    { fid: 200, username: "Bob", stack: 1000, seat_index: 1 },
    { fid: 300, username: "Carol", stack: 1000, seat_index: 2 },
  ]);

  await dealNewHand(table1, [100, 200, 300]);

  let table = await getTable(table1);
  let players = await getPlayers(table1);
  const pos1 = getPositions(players, Number(table.dealer_seat_index));

  assert(table.phase === "preflop", "hand starts at preflop");
  assert(Number(table.dealer_seat_index) === 1, "dealer rotated to seat 1");
  assert(Number(pos1.sb.seat_index) === 2, "seat after dealer is SB");
  assert(Number(pos1.bb.seat_index) === 0, "seat after SB is BB");
  assert(table.current_turn_fid === pos1.utg.fid, "UTG acts first preflop");

  const sbBet = Number(pos1.sb.current_bet);
  const bbBet = Number(pos1.bb.current_bet);
  assert(sbBet === 10 && bbBet === 20, "SB/BB posted level 1 blinds");
  assert(Number(table.pot_size) === 10 + 20 + 5 * 3, "preflop pot includes blinds and antes");

  // UTG calls 20, SB calls 10 more, BB checks
  await simulateCall(table1, Number(pos1.utg.fid), 20);
  await simulateCall(table1, Number(pos1.sb.fid), 20);
  await simulateCheck(table1, Number(pos1.bb.fid), []);

  const preflopActive = (await getPlayers(table1)).filter((p) => p.status === "playing");
  assert(isStreetOver(preflopActive, 20), "preflop is street over after BB checks");

  await advanceGame(table1, table);
  table = await getTable(table1);
  players = await getPlayers(table1);
  const pos1Post = getPositions(players, Number(table.dealer_seat_index));

  assert(table.phase === "flop", "advanced to flop");
  assert(table.board.split(",").length === 3, "flop has 3 cards");
  assert(table.current_turn_fid === pos1Post.sb.fid, "SB acts first postflop");
  assert(Number(table.current_bet) === 0, "bets reset for new street");

  // Check down flop, turn, river
  while (table.phase !== "showdown") {
    const active = (await getPlayers(table1)).filter((p) => p.status === "playing");
    const order = active.map((p) => Number(p.fid));
    await runStreet(table1, order, "check", 0);
    table = await getTable(table1);
  }

  assert(table.phase === "showdown", "reached showdown");
  assert(table.board.split(",").length === 5, "board has 5 cards at showdown");

  // --- Side pot test: short stack all-in ---
  console.log("\n--- Side pot: short-stack all-in ---");
  const table2 = "test_table_2";
  await setupTestTable(table2, [
    { fid: 400, username: "Shorty", stack: 60, seat_index: 0 },
    { fid: 500, username: "Deep1", stack: 1000, seat_index: 1 },
    { fid: 600, username: "Deep2", stack: 1000, seat_index: 2 },
  ]);

  await dealNewHand(table2, [400, 500, 600]);

  let t2 = await getTable(table2);
  const players2 = await getPlayers(table2);
  const pos2 = getPositions(players2, Number(t2.dealer_seat_index));

  // UTG (Deep1) raises to 100
  await simulateBet(table2, Number(pos2.utg.fid), 100);
  // SB (Deep2) calls 100
  await simulateCall(table2, Number(pos2.sb.fid), 100);
  // BB (Shorty) goes all-in for 100 total (80 more)
  const shortyCurrentBet = Number(pos2.bb.current_bet);
  const shortyStack = Number(pos2.bb.stack_size);
  const shortyAllInDiff = Math.min(shortyStack, 100 - shortyCurrentBet);
  await db.execute({
    sql: "UPDATE players SET stack_size = stack_size - ?, current_bet = ?, total_invested = total_invested + ?, has_acted = 1 WHERE fid = ? AND table_id = ?",
    args: [shortyAllInDiff, shortyCurrentBet + shortyAllInDiff, shortyAllInDiff, pos2.bb.fid, table2],
  });
  await db.execute({
    sql: "UPDATE tables SET pot_size = pot_size + ?, current_bet = ? WHERE id = ?",
    args: [shortyAllInDiff, Math.max(100, shortyCurrentBet + shortyAllInDiff), table2],
  });

  // Street over: Shorty all-in, Deep1 and Deep2 matched 100
  const t2Active = (await getPlayers(table2)).filter((p) => p.status === "playing");
  assert(isStreetOver(t2Active, 100), "preflop street over after shorty all-in and calls");

  await advanceGame(table2, t2);
  t2 = await getTable(table2);
  assert(t2.phase === "flop", "advanced to flop with short-stack all-in");

  // Check down to river, then capture pot before the final showdown resolution
  while (t2.phase !== "river") {
    const active = (await getPlayers(t2.id)).filter((p) => p.status === "playing");
    const order = active.map((p) => Number(p.fid));
    await runStreet(t2.id, order, "check", 0);
    t2 = await getTable(t2.id);
  }

  // River checked down; capture pot then advance to showdown.
  let potSize = Number(t2.pot_size);
  const t2BeforeShowdown = await getPlayers(t2.id);
  assert(potSize === 270, "total pot is 270 (180 main + 90 side)");

  await advanceGame(t2.id, t2);
  const t2Players = await getPlayers(t2.id);
  const totalChipsAfter = t2Players.reduce((sum, p) => sum + Number(p.stack_size), 0);
  const totalChipsBefore = t2BeforeShowdown.reduce((sum, p) => sum + Number(p.stack_size), 0) + potSize;

  assert(totalChipsAfter === totalChipsBefore, "total chips preserved after showdown");

  const shorty = t2Players.find((p) => p.fid === 400);
  assert(Number(shorty?.stack_size) <= 180, "shorty can win at most main pot (180)");

  // --- Hand evaluator sanity check ---
  console.log("\n--- Hand evaluator sanity ---");
  const royalFlush = ["Ah", "Kh"] as [string, string];
  const boardRF = ["Qh", "Jh", "Th", "2c", "3d"];
  const pairOfAces = ["Ad", "Ac"] as [string, string];
  const winners = rankShowdownWinners(
    [{ holeCards: royalFlush }, { holeCards: pairOfAces }],
    boardRF,
  );
  assert(winners.length === 1 && winners[0] === 0, "royal flush beats pocket aces");

  console.log("\n=== Results ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  // Cleanup
  try {
    await db.execute({ sql: "DELETE FROM players WHERE table_id LIKE 'test_table_%'" });
    await db.execute({ sql: "DELETE FROM tables WHERE id LIKE 'test_table_%'" });
    await db.execute({ sql: "DELETE FROM hand_history WHERE table_id LIKE 'test_table_%'" });
    await db.execute({ sql: "DELETE FROM player_stats WHERE fid >= 100 AND fid <= 600" });
  } catch (e) {
    // ignore cleanup errors
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
