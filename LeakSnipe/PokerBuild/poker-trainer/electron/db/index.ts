import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { app } from 'electron';
import path from 'path';

let sqlite: any;
let db: any;
let dbUrl: string;

export function initDatabase() {
    try {
        if (db) return { db, dbUrl };

        const dbPath = path.join(app.getPath('userData'), 'poker-tracker.sqlite');
        dbUrl = dbPath;

        console.log('Initializing DB at:', dbPath);
        sqlite = new Database(dbPath);

        // Initialize DB schema manually for now since we're using raw better-sqlite3
        sqlite.exec(`
          CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            site TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            site TEXT NOT NULL,
            start_time INTEGER NOT NULL,
            end_time INTEGER
          );

          CREATE TABLE IF NOT EXISTS hands (
            id TEXT PRIMARY KEY,
            session_id TEXT REFERENCES sessions(id),
            site TEXT NOT NULL,
            game_type TEXT NOT NULL,
            stakes TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            board TEXT,
            hero_cards TEXT,
            pot_size INTEGER NOT NULL,
            won_pot INTEGER NOT NULL,
            net_amount INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hand_id TEXT NOT NULL REFERENCES hands(id),
            player_name TEXT NOT NULL,
            action_type TEXT NOT NULL,
            amount INTEGER DEFAULT 0,
            street TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS hand_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hand_id TEXT NOT NULL REFERENCES hands(id),
            tag TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            UNIQUE(hand_id, tag)
          );
        `);

        db = drizzle(sqlite);
        return { db, dbUrl };
    } catch (e) {
        console.error('Failed to init DB:', e);
        throw e;
    }
}

export { sqlite, db, dbUrl };

