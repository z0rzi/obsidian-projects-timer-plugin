import type { ApiError, PushChange, PushResponse, PushResult } from "./api";

/**
 * The plugin's only door to the Client app. Parser, kanban, Inbox and Push
 * screen depend on this interface, never on HTTP. Grows with later tickets
 * (pull, comments, upload, triage, markRead).
 */
export interface Remote {
	push(changes: PushChange[]): Promise<PushResult[]>;
}

export type RemoteErrorKind = "config" | "auth" | "network" | "server";

/** A call that failed as a whole; `message` is ready for a Notice. */
export class RemoteError extends Error {
	constructor(
		readonly kind: RemoteErrorKind,
		message: string,
	) {
		super(message);
		this.name = "RemoteError";
	}
}

export interface TransportRequest {
	url: string;
	method: "GET" | "POST";
	headers: Record<string, string>;
	body?: string;
}

/** Sends one HTTP request. `json` is the parsed body, or null if it isn't JSON. */
export type Transport = (req: TransportRequest) => Promise<{ status: number; json: unknown }>;

export interface RemoteConfig {
	/** App URL, e.g. `https://suivi.mbz-dev.com`. */
	url: string;
	/** Personal API token from the app's Paramètres page. */
	token: string;
}

/** The `edf-suivi` HTTP API. */
export function createHttpRemote(config: RemoteConfig, transport: Transport): Remote {
	async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
		const base = config.url.trim().replace(/\/+$/, "");
		const token = config.token.trim();
		if (!base || !token) {
			throw new RemoteError("config", "Suivi: set the app URL and API token in the plugin settings.");
		}
		let res: { status: number; json: unknown };
		try {
			res = await transport({
				url: `${base}/api${path}`,
				method,
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		} catch (e) {
			throw new RemoteError("network", `Suivi unreachable at ${base}: ${(e as Error).message}`);
		}
		const error = (res.json as Partial<ApiError> | null)?.error;
		if (res.status === 401 || res.status === 403) {
			throw new RemoteError(
				"auth",
				`Suivi rejected the API token${error ? ` (${error})` : ""}. Check it in the plugin settings.`,
			);
		}
		if (res.status < 200 || res.status >= 300 || res.json === null) {
			throw new RemoteError("server", `Suivi error (HTTP ${res.status})${error ? `: ${error}` : ""}`);
		}
		return res.json as T;
	}

	return {
		async push(changes) {
			return (await call<PushResponse>("POST", "/push", { changes })).results;
		},
	};
}
