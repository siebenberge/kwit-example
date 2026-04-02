import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

const dbPath = process.env.SQLITE_PATH ?? "data/example-todos.db";
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
	mkdirSync(dbDir, { recursive: true });
}

export type Plan = "free" | "basic" | "pro";

export interface UserRow {
	id: string;
	email: string;
	password_hash: string;
	kwit_customer_id: string | null;
	plan: Plan;
	subscription_id: string | null;
	last_checkout_session_id: string | null;
	created_at: string;
}

export interface TodoRow {
	id: string;
	user_id: string;
	title: string;
	notes: string | null;
	done: number;
	created_at: string;
}

export const db = new Database(dbPath, { create: true });

db.run("PRAGMA foreign_keys = ON");

db.run(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  kwit_customer_id TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'basic', 'pro')),
  subscription_id TEXT,
  last_checkout_session_id TEXT,
  created_at TEXT NOT NULL
);
`);

db.run(`
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
`);

db.run(`
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

const todoColumns = db.query("SELECT name FROM pragma_table_info('todos')").all() as {
	name: string;
}[];
if (!todoColumns.some((c) => c.name === "notes")) {
	db.run("ALTER TABLE todos ADD COLUMN notes TEXT");
}

export function getUserById(id: string): UserRow | null {
	const row = db.query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
	return row ?? null;
}

export function getUserByEmail(email: string): UserRow | null {
	const row = db.query("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
	return row ?? null;
}

export function getUserByKwitCustomerId(customerId: string): UserRow | null {
	const row = db.query("SELECT * FROM users WHERE kwit_customer_id = ?").get(customerId) as
		| UserRow
		| undefined;
	return row ?? null;
}

export function getUserBySubscriptionId(subscriptionId: string): UserRow | null {
	const row = db.query("SELECT * FROM users WHERE subscription_id = ?").get(subscriptionId) as
		| UserRow
		| undefined;
	return row ?? null;
}

export function todoLimitForPlan(plan: Plan): number {
	switch (plan) {
		case "free":
			return 5;
		case "basic":
			return 50;
		case "pro":
			return 10_000;
	}
}

export function countTodosForUser(userId: string): number {
	const row = db.query("SELECT COUNT(*) as c FROM todos WHERE user_id = ?").get(userId) as
		| { c: number }
		| undefined;
	return row?.c ?? 0;
}
