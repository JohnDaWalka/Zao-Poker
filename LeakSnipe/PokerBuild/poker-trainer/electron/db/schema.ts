import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const players = sqliteTable('players', {
  id: integer('id').primaryKey(),
  name: text('name').notNull().unique(),
  site: text('site').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // Using UUID or unique string
  site: text('site').notNull(), // BetACR or CoinPoker
  startTime: integer('start_time', { mode: 'timestamp' }).notNull(),
  endTime: integer('end_time', { mode: 'timestamp' }),
});

export const hands = sqliteTable('hands', {
  id: text('id').primaryKey(), // Usually sites have unique string hand IDs
  sessionId: text('session_id').references(() => sessions.id),
  site: text('site').notNull(),
  gameType: text('game_type').notNull(), // e.g. NLHE
  stakes: text('stakes').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  board: text('board'), // comma separated cards e.g., 'As,Kd,7c'
  heroCards: text('hero_cards'), // comma separated
  potSize: integer('pot_size').notNull(),
  wonPot: integer('won_pot').notNull(), // Does hero win
  netAmount: integer('net_amount').notNull(),
});

export const actions = sqliteTable('actions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  handId: text('hand_id').references(() => hands.id).notNull(),
  playerName: text('player_name').notNull(),
  actionType: text('action_type').notNull(), // fold, call, raise, bet, check, post
  amount: integer('amount').default(0),
  street: text('street').notNull(), // preflop, flop, turn, river
});
