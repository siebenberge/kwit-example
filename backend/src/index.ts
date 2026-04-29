import Kwit, { type WebhookEventType } from "@kwit/sdk";
import {
	createSession,
	deleteSession,
	getSessionUserId,
	hashPassword,
	pruneExpiredSessions,
	verifyPassword,
} from "./auth";
import { config } from "./config";
import {
	countTodosForUser,
	db,
	getUserByEmail,
	getUserById,
	getUserByKwitCustomerId,
	getUserBySubscriptionId,
	todoLimitForPlan,
	type Plan,
	type TodoRow,
	type UserRow,
} from "./db";
import { getKwit } from "./kwit";
import { asSubscriptionCanceledPayload, asSubscriptionCreatedPayload } from "./webhook-payloads";

function corsHeaders(req: Request): HeadersInit {
	const origin = req.headers.get("Origin") ?? config.publicAppUrl;
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Allow-Credentials": "true",
	};
}

function json(data: object, status = 200, req?: Request): Response {
	const headers: HeadersInit = {
		"Content-Type": "application/json",
		...(req ? corsHeaders(req) : {}),
	};
	return new Response(JSON.stringify(data), { status, headers });
}

function flattenWebhookPayload(payload: object): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(payload)) {
		if (typeof v === "string") out[k] = v;
		else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
	}
	return out;
}

function getBearer(req: Request): string | null {
	const h = req.headers.get("Authorization");
	if (!h?.startsWith("Bearer ")) return null;
	return h.slice(7).trim() || null;
}

function requireUser(req: Request): UserRow | null {
	const token = getBearer(req);
	if (!token) return null;
	const userId = getSessionUserId(token);
	if (!userId) return null;
	return getUserById(userId);
}

function publicUser(u: UserRow) {
	return {
		id: u.id,
		email: u.email,
		plan: u.plan,
		kwitCustomerId: u.kwit_customer_id,
		subscriptionId: u.subscription_id,
		hasActiveSubscription: u.plan !== "free",
	};
}

function priceIdForPlan(plan: Exclude<Plan, "free">): string | null {
	if (plan === "basic") return config.priceIdBasic || null;
	return config.priceIdPro || null;
}

function planFromPriceId(priceId: string): Plan {
	if (config.priceIdBasic && priceId === config.priceIdBasic) return "basic";
	if (config.priceIdPro && priceId === config.priceIdPro) return "pro";
	return "free";
}

async function ensureKwitCustomer(kwit: Kwit, user: UserRow, displayName: string): Promise<string> {
	if (user.kwit_customer_id) return user.kwit_customer_id;
	const created = await kwit.customers.create({
		email: user.email,
		externalId: user.id,
		name: displayName || user.email.split("@")[0],
		currency: "CHF",
	});
	db.run("UPDATE users SET kwit_customer_id = ? WHERE id = ?", [created.id, user.id]);
	return created.id;
}

async function handleRegister(req: Request): Promise<Response> {
	const body = (await req.json()) as {
		email?: string;
		password?: string;
		name?: string;
	};
	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	const password = typeof body.password === "string" ? body.password : "";
	const name = typeof body.name === "string" ? body.name.trim() : "";

	if (!email.includes("@") || password.length < 8) {
		return json({ error: "Invalid email or password (min 8 characters)." }, 400, req);
	}
	if (getUserByEmail(email)) {
		return json({ error: "Email already registered." }, 409, req);
	}

	const id = crypto.randomUUID();
	const password_hash = await hashPassword(password);
	const created_at = new Date().toISOString();

	db.run(
		`INSERT INTO users (id, email, password_hash, kwit_customer_id, plan, subscription_id, last_checkout_session_id, created_at)
     VALUES (?, ?, ?, NULL, 'free', NULL, NULL, ?)`,
		[id, email, password_hash, created_at],
	);

	let user = getUserById(id)!;
	const kwit = getKwit();
	if (kwit) {
		try {
			await ensureKwitCustomer(kwit, user, name);
			user = getUserById(id)!;
		} catch (e) {
			console.error("[register] Kwit customer create failed:", e);
		}
	}

	const token = createSession(id);
	return json({ token, user: publicUser(user) }, 201, req);
}

async function handleLogin(req: Request): Promise<Response> {
	const body = (await req.json()) as { email?: string; password?: string };
	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	const password = typeof body.password === "string" ? body.password : "";
	const user = getUserByEmail(email);
	if (!user || !(await verifyPassword(password, user.password_hash))) {
		return json({ error: "Invalid email or password." }, 401, req);
	}
	const token = createSession(user.id);
	return json({ token, user: publicUser(user) }, 200, req);
}

function handleLogout(req: Request): Response {
	const token = getBearer(req);
	if (token) deleteSession(token);
	return json({ ok: true }, 200, req);
}

function handleMe(req: Request): Response {
	const user = requireUser(req);
	if (!user) return json({ error: "Unauthorized." }, 401, req);
	return json({ user: publicUser(user) }, 200, req);
}

function listTodos(userId: string): TodoRow[] {
	return db
		.query("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC")
		.all(userId) as TodoRow[];
}

function handleListTodos(req: Request): Response {
	const user = requireUser(req);
	if (!user) return json({ error: "Unauthorized." }, 401, req);
	return json({ todos: listTodos(user.id) }, 200, req);
}

async function handleCreateTodo(req: Request): Promise<Response> {
	const user = requireUser(req);
	if (!user) return json({ error: "Unauthorized." }, 401, req);

	const limit = todoLimitForPlan(user.plan);
	if (countTodosForUser(user.id) >= limit) {
		return json(
			{
				error: `Todo limit reached for ${user.plan} plan (${limit}). Upgrade on the pricing page.`,
			},
			403,
			req,
		);
	}

	const body = (await req.json()) as { title?: string; notes?: string };
	const title = typeof body.title === "string" ? body.title.trim() : "";
	if (!title) return json({ error: "Title required." }, 400, req);

	const notes =
		user.plan === "pro" && typeof body.notes === "string" ? body.notes.trim() || null : null;

	const id = crypto.randomUUID();
	const created_at = new Date().toISOString();
	db.run(
		"INSERT INTO todos (id, user_id, title, notes, done, created_at) VALUES (?, ?, ?, ?, 0, ?)",
		[id, user.id, title, notes, created_at],
	);
	const row = db.query("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow;
	return json({ todo: row }, 201, req);
}

async function handlePatchTodo(req: Request, id: string): Promise<Response> {
	const user = requireUser(req);
	if (!user) return json({ error: "Unauthorized." }, 401, req);

	const row = db.query("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(id, user.id) as
		| TodoRow
		| undefined;
	if (!row) return json({ error: "Not found." }, 404, req);

	const body = (await req.json()) as { title?: string; done?: boolean; notes?: string };
	const title = typeof body.title === "string" ? body.title.trim() : row.title;
	const done = typeof body.done === "boolean" ? (body.done ? 1 : 0) : row.done;
	let notes = row.notes;
	if (user.plan === "pro" && typeof body.notes === "string") {
		notes = body.notes.trim() || null;
	}

	db.run("UPDATE todos SET title = ?, done = ?, notes = ? WHERE id = ?", [title, done, notes, id]);
	const next = db.query("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow;
	return json({ todo: next }, 200, req);
}

function handleDeleteTodo(req: Request, id: string): Response {
	const user = requireUser(req);
	if (!user) return json({ error: "Unauthorized." }, 401, req);

	const res = db.run("DELETE FROM todos WHERE id = ? AND user_id = ?", [id, user.id]);
	if (res.changes === 0) return json({ error: "Not found." }, 404, req);
	return json({ ok: true }, 200, req);
}

async function handleCheckout(req: Request): Promise<Response> {
	const user = requireUser(req);
	if (!user) return json({ error: "Unauthorized." }, 401, req);

	const kwit = getKwit();
	if (!kwit) {
		return json({ error: "Server missing KWIT_API_KEY — cannot start checkout." }, 503, req);
	}

	const body = (await req.json()) as { plan?: string };
	const plan = body.plan === "basic" || body.plan === "pro" ? body.plan : null;
	if (!plan) return json({ error: 'plan must be "basic" or "pro".' }, 400, req);

	const priceId = priceIdForPlan(plan);
	if (!priceId) {
		return json(
			{ error: `Set PRICE_ID_${plan.toUpperCase()} for the Kwit price id from your dashboard.` },
			503,
			req,
		);
	}

	let u = user;
	const customerId = await ensureKwitCustomer(kwit, u, u.email.split("@")[0] ?? "User");
	u = getUserById(user.id)!;

	const successUrl = `${config.publicAppUrl}/billing/return`;
	const cancelUrl = `${config.publicAppUrl}/pricing`;

	const result = await kwit.checkout.create({
		customerId,
		priceId,
		successUrl,
		cancelUrl,
		metadata: { appUserId: u.id, tier: plan },
	});
	console.log("result", result);

	db.run("UPDATE users SET last_checkout_session_id = ? WHERE id = ?", [result.sessionId, u.id]);

	const redirectStartUrl =
		"redirectStartUrl" in result && typeof result.redirectStartUrl === "string"
			? result.redirectStartUrl
			: result.checkoutUrl;

	return json(
		{
			redirectStartUrl,
			checkoutUrl: result.checkoutUrl,
			sessionId: result.sessionId,
		},
		200,
		req,
	);
}

async function handleBillingSync(req: Request): Promise<Response> {
	const user = requireUser(req);
	if (!user) return json({ error: "Unauthorized." }, 401, req);

	const kwit = getKwit();
	if (!kwit) return json({ error: "KWIT_API_KEY not configured." }, 503, req);

	const sessionId = user.last_checkout_session_id;
	if (!sessionId) {
		return json({ synced: false, message: "No checkout session to sync." }, 200, req);
	}

	const session = await kwit.checkout.sessions.retrieve(sessionId);
	if (session.status !== "COMPLETE" || !session.subscription) {
		return json({ synced: false, sessionStatus: session.status }, 200, req);
	}

	const priceId = session.subscription.price.id;
	const plan = planFromPriceId(priceId);
	const subId = session.subscription.id;

	db.run("UPDATE users SET plan = ?, subscription_id = ? WHERE id = ?", [plan, subId, user.id]);
	const updated = getUserById(user.id)!;
	return json({ synced: true, user: publicUser(updated) }, 200, req);
}

async function handleBillingPortal(req: Request): Promise<Response> {
	const user = requireUser(req);
	if (!user) return json({ error: "Unauthorized." }, 401, req);

	const kwit = getKwit();
	if (!kwit) {
		return json({ error: "Server missing KWIT_API_KEY — cannot open portal." }, 503, req);
	}

	if (!user.kwit_customer_id) {
		return json(
			{ error: "No Kwit customer on file yet. Subscribe to a plan first." },
			400,
			req,
		);
	}

	const portal = await kwit.portal.sessions.create({
		customerId: user.kwit_customer_id,
		returnUrl: `${config.publicAppUrl}/`,
	});

	return json(
		{
			url: portal.url,
			expiresAt: portal.expiresAt,
			sessionId: portal.sessionId,
		},
		200,
		req,
	);
}

async function handleKwitWebhook(req: Request): Promise<Response> {
	const secret = config.kwitWebhookSecret;
	if (!secret) {
		console.error("[webhook] KWIT_WEBHOOK_SECRET not set");
		return new Response("Webhook not configured", { status: 503 });
	}

	const raw = await req.text();
	const sig = req.headers.get("Kwit-Signature") ?? "";
	const event = req.headers.get("Kwit-Event") ?? "";

	const kwit = new Kwit(config.kwitApiKey || "");
	let verified: ReturnType<typeof kwit.webhooks.verify>;
	try {
		verified = kwit.webhooks.verify(raw, sig, event, secret);
	} catch (e) {
		console.warn("[webhook] verify failed:", e);
		return new Response("Invalid signature", { status: 400 });
	}

	const { payload, type } = verified;
	const flatPayload = flattenWebhookPayload(payload);

	if (type === "subscription.canceled") {
		const p = asSubscriptionCanceledPayload(flatPayload);
		if (p) {
			const u = getUserBySubscriptionId(p.subscriptionId);
			if (u) {
				db.run("UPDATE users SET plan = 'free', subscription_id = NULL WHERE id = ?", [u.id]);
				console.log(`[webhook] user ${u.id} downgraded after subscription cancel`);
			}
		}
	}

	if (type === "subscription.created") {
		const p = asSubscriptionCreatedPayload(flatPayload);
		if (p) {
			const u = getUserByKwitCustomerId(p.customerId);
			if (u?.last_checkout_session_id) {
				syncUserFromCheckoutSession(u.id, p.subscriptionId).catch((err) =>
					console.error("[webhook] sync after subscription.created failed:", err),
				);
			}
		}
	}

	return new Response(JSON.stringify({ received: true }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

async function syncUserFromCheckoutSession(userId: string, subscriptionId: string): Promise<void> {
	const kwit = getKwit();
	if (!kwit) return;
	const user = getUserById(userId);
	if (!user?.last_checkout_session_id) return;

	const session = await kwit.checkout.sessions.retrieve(user.last_checkout_session_id);
	if (session.status !== "COMPLETE" || !session.subscription) return;

	const priceId = session.subscription.price.id;
	const plan = planFromPriceId(priceId);
	db.run("UPDATE users SET plan = ?, subscription_id = ? WHERE id = ?", [
		plan,
		subscriptionId,
		userId,
	]);
}

async function handleRequest(req: Request): Promise<Response> {
	pruneExpiredSessions();

	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders(req) });
	}

	const url = new URL(req.url);
	const path = url.pathname;

	try {
		if (path === "/api/auth/register" && req.method === "POST") {
			return handleRegister(req);
		}
		if (path === "/api/auth/login" && req.method === "POST") {
			return handleLogin(req);
		}
		if (path === "/api/auth/logout" && req.method === "POST") {
			return handleLogout(req);
		}
		if (path === "/api/me" && req.method === "GET") {
			return handleMe(req);
		}
		if (path === "/api/todos" && req.method === "GET") {
			return handleListTodos(req);
		}
		if (path === "/api/todos" && req.method === "POST") {
			return handleCreateTodo(req);
		}
		if (path.startsWith("/api/todos/") && req.method === "PATCH") {
			const id = path.slice("/api/todos/".length);
			return handlePatchTodo(req, id);
		}
		if (path.startsWith("/api/todos/") && req.method === "DELETE") {
			const id = path.slice("/api/todos/".length);
			return handleDeleteTodo(req, id);
		}
		if (path === "/api/billing/checkout" && req.method === "POST") {
			return handleCheckout(req);
		}
		if (path === "/api/billing/sync" && req.method === "POST") {
			return handleBillingSync(req);
		}
		if (path === "/api/billing/portal" && req.method === "POST") {
			return handleBillingPortal(req);
		}
		if (path === "/api/webhooks/kwit" && req.method === "POST") {
			return handleKwitWebhook(req);
		}
	} catch (e) {
		console.error("[api]", e);
		const message = e instanceof Error ? e.message : "Server error";
		return json({ error: message }, 500, req);
	}

	return json({ error: "Not found." }, 404, req);
}

const server = Bun.serve({
	// ...(process.env.NODE_ENV !== "production" ? {
	// 	routes: {
	// 		"/*": await import("../dist/index.html"),
	// 	}
	// } : {}),
	port: config.port,
	fetch: handleRequest,
});

console.log(`Example API running at ${server.url} (webhooks: POST /api/webhooks/kwit)`);
