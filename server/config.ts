function requireEnv(name: string, opts: { optional?: boolean } = {}): string {
	const v = process.env[name];
	if (!v && !opts.optional) {
		console.warn(`[config] Missing ${name} — billing features will fail until it is set.`);
	}
	return v ?? "";
}

export const config = {
	port: Number.parseInt(process.env.PORT ?? "3001", 10),
	publicAppUrl: process.env.PUBLIC_APP_URL ?? "http://localhost:5173",
	kwitApiKey: requireEnv("KWIT_API_KEY", { optional: true }),
	kwitWebhookSecret: requireEnv("KWIT_WEBHOOK_SECRET", { optional: true }),
	priceIdBasic: requireEnv("PRICE_ID_BASIC", { optional: true }),
	priceIdPro: requireEnv("PRICE_ID_PRO", { optional: true }),
};
