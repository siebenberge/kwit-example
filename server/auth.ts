import { db } from "./db";

const SESSION_DAYS = 14;

export async function hashPassword(password: string): Promise<string> {
	return Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
	return Bun.password.verify(password, hash);
}

export function createSession(userId: string): string {
	const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
	const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400;
	db.run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", [
		token,
		userId,
		expiresAt,
	]);
	return token;
}

export function deleteSession(token: string): void {
	db.run("DELETE FROM sessions WHERE token = ?", [token]);
}

export function getSessionUserId(token: string): string | null {
	const now = Math.floor(Date.now() / 1000);
	const row = db
		.query("SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?")
		.get(token, now) as { user_id: string } | undefined;
	return row?.user_id ?? null;
}

export function pruneExpiredSessions(): void {
	const now = Math.floor(Date.now() / 1000);
	db.run("DELETE FROM sessions WHERE expires_at <= ?", [now]);
}
