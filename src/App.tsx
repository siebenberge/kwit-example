import { useCallback, useEffect, useState } from "react";
import {
	billingSyncRequest,
	checkoutRequest,
	createTodoRequest,
	deleteTodoRequest,
	listTodosRequest,
	loginRequest,
	logoutRequest,
	meRequest,
	patchTodoRequest,
	registerRequest,
	getStoredToken,
	setStoredToken,
	type PublicUser,
	type Todo,
	type Plan,
} from "./api";

function useRoute() {
	const [path, setPath] = useState(() => window.location.pathname);

	useEffect(() => {
		const onPop = () => setPath(window.location.pathname);
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	const navigate = useCallback((to: string) => {
		window.history.pushState({}, "", to);
		setPath(to);
	}, []);

	return { path, navigate };
}

const PLAN_LIMITS: Record<Plan, string> = {
	free: "5 todos",
	basic: "50 todos",
	pro: "10k todos + notes",
};

export default function App() {
	const { path, navigate } = useRoute();
	const [token, setToken] = useState<string | null>(() => getStoredToken());
	const [user, setUser] = useState<PublicUser | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [todos, setTodos] = useState<Todo[]>([]);
	const [busy, setBusy] = useState(false);

	const refreshUser = useCallback(async () => {
		if (!token) {
			setUser(null);
			return;
		}
		const { user: u } = await meRequest();
		setUser(u);
	}, [token]);

	const refreshTodos = useCallback(async () => {
		if (!token) {
			setTodos([]);
			return;
		}
		const { todos: list } = await listTodosRequest();
		setTodos(list);
	}, [token]);

	useEffect(() => {
		if (!token) return;
		setLoadError(null);
		meRequest()
			.then(({ user: u }) => setUser(u))
			.catch((e: Error) => {
				setLoadError(e.message);
				setUser(null);
			});
	}, [token]);

	useEffect(() => {
		if (!token || !user) return;
		listTodosRequest()
			.then(({ todos: list }) => setTodos(list))
			.catch(() => setTodos([]));
	}, [token, user]);

	useEffect(() => {
		if (path !== "/billing/return") return;
		if (!token) {
			navigate("/login");
			return;
		}
		setBusy(true);
		billingSyncRequest()
			.then((r) => {
				if (r.user) setUser(r.user);
			})
			.catch((e: Error) => setLoadError(e.message))
			.finally(() => {
				setBusy(false);
				navigate("/");
			});
	}, [path, token, navigate]);

	const handleLogout = async () => {
		setBusy(true);
		try {
			await logoutRequest();
		} catch {
			/* ignore */
		}
		setStoredToken(null);
		setToken(null);
		setUser(null);
		setTodos([]);
		navigate("/login");
		setBusy(false);
	};

	const onLogin = async (email: string, password: string) => {
		setBusy(true);
		setLoadError(null);
		try {
			const { token: t, user: u } = await loginRequest(email, password);
			setStoredToken(t);
			setToken(t);
			setUser(u);
			navigate("/");
		} catch (e) {
			setLoadError(e instanceof Error ? e.message : "Login failed");
		} finally {
			setBusy(false);
		}
	};

	const onRegister = async (email: string, password: string, name: string) => {
		setBusy(true);
		setLoadError(null);
		try {
			const { token: t, user: u } = await registerRequest(email, password, name);
			setStoredToken(t);
			setToken(t);
			setUser(u);
			navigate("/");
		} catch (e) {
			setLoadError(e instanceof Error ? e.message : "Register failed");
		} finally {
			setBusy(false);
		}
	};

	const onSubscribe = async (plan: "basic" | "pro") => {
		setBusy(true);
		setLoadError(null);
		try {
			const { checkoutUrl } = await checkoutRequest(plan);
			window.location.href = checkoutUrl;
		} catch (e) {
			setLoadError(e instanceof Error ? e.message : "Checkout failed");
			setBusy(false);
		}
	};

	if (path === "/billing/return") {
		return (
			<div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
				<p className="text-slate-400">{busy ? "Syncing subscription…" : "Redirecting…"}</p>
			</div>
		);
	}

	if (path === "/login") {
		return (
			<AuthForm
				title="Sign in"
				submitLabel="Sign in"
				onSubmit={onLogin}
				secondaryLabel="Create account"
				onSecondary={() => navigate("/register")}
				error={loadError}
				busy={busy}
			/>
		);
	}

	if (path === "/register") {
		return (
			<RegisterForm
				onSubmit={onRegister}
				secondaryLabel="Already have an account?"
				onSecondary={() => navigate("/login")}
				error={loadError}
				busy={busy}
			/>
		);
	}

	if (path === "/pricing") {
		if (!token || !user) {
			return (
				<div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-6">
					<p>Sign in to choose a plan.</p>
					<button
						type="button"
						className="rounded-lg bg-indigo-500 px-4 py-2 text-white font-medium"
						onClick={() => navigate("/login")}
					>
						Sign in
					</button>
				</div>
			);
		}
		return (
			<PricingPage
				user={user}
				onSubscribe={onSubscribe}
				onBack={() => navigate("/")}
				busy={busy}
				error={loadError}
			/>
		);
	}

	if (!token) {
		return (
			<div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-6 p-6">
				<div className="text-center space-y-2">
					<h1 className="text-3xl font-semibold tracking-tight">Kwit Todo Example</h1>
					<p className="text-slate-400 max-w-md">
						Demo SaaS: Bun + SQLite auth, todos gated by plan, billing via{" "}
						<code className="text-indigo-300">@kwit/sdk</code>.
					</p>
				</div>
				<div className="flex gap-3">
					<button
						type="button"
						className="rounded-lg bg-indigo-500 px-5 py-2.5 text-white font-medium shadow-lg shadow-indigo-500/25"
						onClick={() => navigate("/login")}
					>
						Sign in
					</button>
					<button
						type="button"
						className="rounded-lg border border-slate-600 px-5 py-2.5 font-medium text-slate-200 hover:bg-slate-900"
						onClick={() => navigate("/register")}
					>
						Register
					</button>
				</div>
			</div>
		);
	}

	if (loadError && !user) {
		return (
			<div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-6">
				<p className="text-red-400">{loadError}</p>
				<button
					type="button"
					className="text-indigo-400 underline"
					onClick={() => {
						setLoadError(null);
						handleLogout();
					}}
				>
					Clear session
				</button>
			</div>
		);
	}

	if (!user) {
		return (
			<div className="min-h-screen bg-slate-950 flex items-center justify-center">
				<p className="text-slate-500">Loading…</p>
			</div>
		);
	}

	return (
		<TodoDashboard
			user={user}
			todos={todos}
			onLogout={handleLogout}
			onNavigatePricing={() => navigate("/pricing")}
			onRefreshTodos={refreshTodos}
			onRefreshUser={refreshUser}
			loadError={loadError}
			setLoadError={setLoadError}
			busy={busy}
			setBusy={setBusy}
		/>
	);
}

function AuthForm(props: {
	title: string;
	submitLabel: string;
	onSubmit: (email: string, password: string) => Promise<void>;
	secondaryLabel: string;
	onSecondary: () => void;
	error: string | null;
	busy: boolean;
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	return (
		<div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
			<form
				className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-8 shadow-xl"
				onSubmit={(ev) => {
					ev.preventDefault();
					void props.onSubmit(email, password);
				}}
			>
				<h1 className="text-xl font-semibold">{props.title}</h1>
				{props.error ? <p className="text-sm text-red-400">{props.error}</p> : null}
				<label className="block space-y-1 text-sm">
					<span className="text-slate-400">Email</span>
					<input
						className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
					/>
				</label>
				<label className="block space-y-1 text-sm">
					<span className="text-slate-400">Password</span>
					<input
						className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						minLength={8}
					/>
				</label>
				<button
					type="submit"
					disabled={props.busy}
					className="w-full rounded-lg bg-indigo-500 py-2.5 font-medium text-white disabled:opacity-50"
				>
					{props.submitLabel}
				</button>
				<button
					type="button"
					className="w-full text-sm text-slate-400 hover:text-indigo-400"
					onClick={props.onSecondary}
				>
					{props.secondaryLabel}
				</button>
			</form>
		</div>
	);
}

function RegisterForm(props: {
	onSubmit: (email: string, password: string, name: string) => Promise<void>;
	secondaryLabel: string;
	onSecondary: () => void;
	error: string | null;
	busy: boolean;
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");

	return (
		<div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
			<form
				className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-8 shadow-xl"
				onSubmit={(ev) => {
					ev.preventDefault();
					void props.onSubmit(email, password, name);
				}}
			>
				<h1 className="text-xl font-semibold">Create account</h1>
				{props.error ? <p className="text-sm text-red-400">{props.error}</p> : null}
				<label className="block space-y-1 text-sm">
					<span className="text-slate-400">Name</span>
					<input
						className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</label>
				<label className="block space-y-1 text-sm">
					<span className="text-slate-400">Email</span>
					<input
						className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
					/>
				</label>
				<label className="block space-y-1 text-sm">
					<span className="text-slate-400">Password</span>
					<input
						className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						minLength={8}
					/>
				</label>
				<button
					type="submit"
					disabled={props.busy}
					className="w-full rounded-lg bg-indigo-500 py-2.5 font-medium text-white disabled:opacity-50"
				>
					Register
				</button>
				<button
					type="button"
					className="w-full text-sm text-slate-400 hover:text-indigo-400"
					onClick={props.onSecondary}
				>
					{props.secondaryLabel}
				</button>
			</form>
		</div>
	);
}

function PricingPage(props: {
	user: PublicUser;
	onSubscribe: (plan: "basic" | "pro") => Promise<void>;
	onBack: () => void;
	busy: boolean;
	error: string | null;
}) {
	return (
		<div className="min-h-screen bg-slate-950 text-slate-100 p-6">
			<div className="max-w-3xl mx-auto space-y-8">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-semibold">Pricing</h1>
						<p className="text-slate-400 text-sm mt-1">
							Logged in as {props.user.email} · Current plan:{" "}
							<span className="text-indigo-300 capitalize">{props.user.plan}</span>
						</p>
					</div>
					<button
						type="button"
						className="text-sm text-slate-400 hover:text-white"
						onClick={props.onBack}
					>
						← Back to todos
					</button>
				</div>
				{props.error ? <p className="text-red-400 text-sm">{props.error}</p> : null}
				<div className="grid md:grid-cols-2 gap-6">
					<div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
						<h2 className="text-lg font-medium">Basic</h2>
						<p className="text-slate-400 text-sm">{PLAN_LIMITS.basic}</p>
						<p className="text-slate-500 text-xs">
							Maps to <code className="text-slate-400">PRICE_ID_BASIC</code> in your Kwit org.
						</p>
						<button
							type="button"
							disabled={props.busy || props.user.plan === "basic"}
							className="w-full rounded-lg bg-indigo-500 py-2.5 font-medium text-white disabled:opacity-50"
							onClick={() => void props.onSubscribe("basic")}
						>
							{props.user.plan === "basic" ? "Subscribed" : "Subscribe"}
						</button>
					</div>
					<div className="rounded-2xl border border-indigo-500/40 bg-indigo-950/20 p-6 space-y-4 ring-1 ring-indigo-500/20">
						<h2 className="text-lg font-medium text-indigo-200">Pro</h2>
						<p className="text-slate-400 text-sm">{PLAN_LIMITS.pro}</p>
						<p className="text-slate-500 text-xs">
							Maps to <code className="text-slate-400">PRICE_ID_PRO</code> in your Kwit org.
						</p>
						<button
							type="button"
							disabled={props.busy || props.user.plan === "pro"}
							className="w-full rounded-lg bg-indigo-500 py-2.5 font-medium text-white disabled:opacity-50"
							onClick={() => void props.onSubscribe("pro")}
						>
							{props.user.plan === "pro" ? "Subscribed" : "Subscribe"}
						</button>
					</div>
				</div>
				<p className="text-xs text-slate-600 max-w-xl">
					Configure webhook URL on Kwit:{" "}
					<code className="text-slate-500">{"<your-api-host>/api/webhooks/kwit"}</code> with events{" "}
					<code className="text-slate-500">subscription.created</code>,{" "}
					<code className="text-slate-500">subscription.canceled</code>. Set{" "}
					<code className="text-slate-500">KWIT_WEBHOOK_SECRET</code> to the endpoint secret.
				</p>
			</div>
		</div>
	);
}

function TodoDashboard(props: {
	user: PublicUser;
	todos: Todo[];
	onLogout: () => Promise<void>;
	onNavigatePricing: () => void;
	onRefreshTodos: () => Promise<void>;
	onRefreshUser: () => Promise<void>;
	loadError: string | null;
	setLoadError: (e: string | null) => void;
	busy: boolean;
	setBusy: (b: boolean) => void;
}) {
	const [title, setTitle] = useState("");
	const [notes, setNotes] = useState("");

	const limitLabel = PLAN_LIMITS[props.user.plan];
	const atLimit =
		props.user.plan !== "pro" && props.todos.length >= (props.user.plan === "free" ? 5 : 50);

	const addTodo = async () => {
		const t = title.trim();
		if (!t) return;
		props.setBusy(true);
		props.setLoadError(null);
		try {
			await createTodoRequest(t, props.user.plan === "pro" ? notes : undefined);
			setTitle("");
			setNotes("");
			await props.onRefreshTodos();
			await props.onRefreshUser();
		} catch (e) {
			props.setLoadError(e instanceof Error ? e.message : "Failed");
		} finally {
			props.setBusy(false);
		}
	};

	return (
		<div className="min-h-screen bg-slate-950 text-slate-100">
			<header className="border-b border-slate-800 bg-slate-900/30">
				<div className="max-w-2xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h1 className="font-semibold text-lg">Todos</h1>
						<p className="text-xs text-slate-500">
							{props.user.email} ·{" "}
							<span className="capitalize text-indigo-300">{props.user.plan}</span> · {limitLabel}
						</p>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
							onClick={props.onNavigatePricing}
						>
							Plans
						</button>
						<button
							type="button"
							className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:text-white"
							onClick={() => void props.onLogout()}
						>
							Log out
						</button>
					</div>
				</div>
			</header>

			<main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
				{props.loadError ? <p className="text-sm text-red-400">{props.loadError}</p> : null}

				<form
					className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/30 p-4"
					onSubmit={(ev) => {
						ev.preventDefault();
						void addTodo();
					}}
				>
					<input
						className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
						placeholder="New task"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						disabled={props.busy || atLimit}
					/>
					{props.user.plan === "pro" ? (
						<textarea
							className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm min-h-[72px]"
							placeholder="Notes (Pro)"
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							disabled={props.busy || atLimit}
						/>
					) : null}
					<button
						type="submit"
						disabled={props.busy || atLimit}
						className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
					>
						{atLimit ? "Limit reached — upgrade" : "Add todo"}
					</button>
				</form>

				<ul className="space-y-2">
					{props.todos.map((todo) => (
						<li
							key={todo.id}
							className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/20 p-4 sm:flex-row sm:items-start sm:justify-between"
						>
							<div className="flex gap-3 items-start">
								<input
									type="checkbox"
									checked={todo.done === 1}
									onChange={(e) => {
										void (async () => {
											props.setBusy(true);
											try {
												await patchTodoRequest(todo.id, { done: e.target.checked });
												await props.onRefreshTodos();
											} catch (err) {
												props.setLoadError(err instanceof Error ? err.message : "Update failed");
											} finally {
												props.setBusy(false);
											}
										})();
									}}
									className="mt-1 rounded border-slate-600"
								/>
								<div>
									<p className={todo.done === 1 ? "text-slate-500 line-through" : ""}>
										{todo.title}
									</p>
									{todo.notes ? (
										<p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{todo.notes}</p>
									) : null}
								</div>
							</div>
							<button
								type="button"
								className="text-xs text-red-400/80 hover:text-red-400"
								onClick={() => {
									void (async () => {
										props.setBusy(true);
										try {
											await deleteTodoRequest(todo.id);
											await props.onRefreshTodos();
										} catch (err) {
											props.setLoadError(err instanceof Error ? err.message : "Delete failed");
										} finally {
											props.setBusy(false);
										}
									})();
								}}
							>
								Delete
							</button>
						</li>
					))}
				</ul>

				{props.todos.length === 0 ? (
					<p className="text-center text-slate-600 text-sm py-8">No todos yet.</p>
				) : null}
			</main>
		</div>
	);
}
