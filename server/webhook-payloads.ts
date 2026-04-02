export interface SubscriptionCanceledPayload {
	subscriptionId: string;
	canceledAt?: string;
	reason?: string;
}

export interface SubscriptionCreatedPayload {
	subscriptionId: string;
	customerId: string;
	status: string;
}

function readString(rec: Record<string, string>, key: string): string | undefined {
	const v = rec[key];
	return typeof v === "string" ? v : undefined;
}

export function asSubscriptionCanceledPayload(
	raw: Record<string, string>,
): SubscriptionCanceledPayload | null {
	const subscriptionId = readString(raw, "subscriptionId");
	if (!subscriptionId) return null;
	return {
		subscriptionId,
		canceledAt: readString(raw, "canceledAt"),
		reason: readString(raw, "reason"),
	};
}

export function asSubscriptionCreatedPayload(
	raw: Record<string, string>,
): SubscriptionCreatedPayload | null {
	const subscriptionId = readString(raw, "subscriptionId");
	const customerId = readString(raw, "customerId");
	const status = readString(raw, "status");
	if (!subscriptionId || !customerId || /^\s*$/.test(status ?? "")) return null;
	return { subscriptionId, customerId, status: status ?? "" };
}
