const TOKEN_KEY = "kwit_example_token";

export function getStoredToken(): string | null {
	return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
	if (token) localStorage.setItem(TOKEN_KEY, token);
	else localStorage.removeItem(TOKEN_KEY);
}

export type Plan = "free" | "basic" | "pro";

export interface PublicUser {
	id: string;
	email: string;
	plan: Plan;
	kwitCustomerId: string | null;
	subscriptionId: string | null;
	hasActiveSubscription: boolean;
}

export interface Todo {
	id: string;
	user_id: string;
	title: string;
	notes: string | null;
	done: number;
	created_at: string;
}

async function apiFetch<T>(
	path: string,
	opts: RequestInit & { token?: string | null } = {},
): Promise<T> {
	const headers = new Headers(opts.headers);
	headers.set("Content-Type", "application/json");
	const token = opts.token ?? getStoredToken();
	if (token) headers.set("Authorization", `Bearer ${token}`);

	const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, { ...opts, headers });
	const text = await res.text();
	let body: { error?: string } & Partial<T> = {};
	if (text) {
		try {
			body = JSON.parse(text) as { error?: string } & Partial<T>;
		} catch {
			throw new Error(`Invalid JSON (${res.status})`);
		}
	}
	if (!res.ok) {
		throw new Error(body.error ?? `Request failed (${res.status})`);
	}
	return body as T;
}

export async function registerRequest(
	email: string,
	password: string,
	name: string,
): Promise<{
	token: string;
	user: PublicUser;
}> {
	return apiFetch("/api/auth/register", {
		method: "POST",
		body: JSON.stringify({ email, password, name }),
		token: null,
	});
}

export async function loginRequest(
	email: string,
	password: string,
): Promise<{
	token: string;
	user: PublicUser;
}> {
	return apiFetch("/api/auth/login", {
		method: "POST",
		body: JSON.stringify({ email, password }),
		token: null,
	});
}

export async function logoutRequest(): Promise<void> {
	await apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export async function meRequest(): Promise<{ user: PublicUser }> {
	return apiFetch("/api/me", { method: "GET" });
}

export async function listTodosRequest(): Promise<{ todos: Todo[] }> {
	return apiFetch("/api/todos", { method: "GET" });
}

export async function createTodoRequest(title: string, notes?: string): Promise<{ todo: Todo }> {
	return apiFetch("/api/todos", {
		method: "POST",
		body: JSON.stringify(notes !== undefined ? { title, notes } : { title }),
	});
}

export async function patchTodoRequest(
	id: string,
	patch: { title?: string; done?: boolean; notes?: string },
): Promise<{ todo: Todo }> {
	return apiFetch(`/api/todos/${id}`, {
		method: "PATCH",
		body: JSON.stringify(patch),
	});
}

export async function deleteTodoRequest(id: string): Promise<void> {
	await apiFetch(`/api/todos/${id}`, { method: "DELETE" });
}

export async function checkoutRequest(plan: "basic" | "pro"): Promise<{
	checkoutUrl: string;
	sessionId: string;
}> {
	return apiFetch("/api/billing/checkout", {
		method: "POST",
		body: JSON.stringify({ plan }),
	});
}

export async function billingSyncRequest(): Promise<{
	synced: boolean;
	user?: PublicUser;
	sessionStatus?: string;
	message?: string;
}> {
	return apiFetch("/api/billing/sync", { method: "POST", body: "{}" });
}
