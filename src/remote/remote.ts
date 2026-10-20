import type {
	ApiError,
	Comment,
	CommentResponse,
	CommentsResponse,
	EventsResponse,
	InboxResponse,
	MarkReadResponse,
	PushChange,
	PushResponse,
	PushResult,
	TriageRequest,
	TriageResponse,
} from "./api";

/**
 * The plugin's only door to the Client app. Parser, kanban, Inbox and Push
 * screen depend on this interface, never on HTTP. Grows with later tickets
 * (upload).
 */
export interface Remote {
	push(changes: PushChange[]): Promise<PushResult[]>;
	/** Events after `cursor` (null = from the start) and the cursor to keep. */
	pull(cursor: number | null): Promise<EventsResponse>;
	/** Thread of a Project, Task or Review, oldest first. */
	comments(itemId: string): Promise<Comment[]>;
	/** Adds a comment to an item's thread. */
	comment(itemId: string, body: string): Promise<Comment>;
	/** Changes one's own comment; `null` deletes it. */
	editComment(commentId: string, body: string | null): Promise<void>;
	/** The Developer's Inbox: unread Notifications (read state lives in the app). */
	inbox(): Promise<InboxResponse>;
	/** Marks the events of Inbox entries read. */
	markRead(eventIds: number[]): Promise<void>;
	/** Turns an item À trier into a Task; returns its shared fields as the app now has them. */
	triage(itemId: string, as: TriageRequest): Promise<TriageResponse>;
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

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface TransportRequest {
	url: string;
	method: HttpMethod;
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
	async function call<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
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
		async pull(cursor) {
			return call<EventsResponse>("GET", `/events?since=${cursor ?? 0}`);
		},
		async comments(itemId) {
			return (await call<CommentsResponse>("GET", `/items/${encodeURIComponent(itemId)}/comments`)).comments;
		},
		async comment(itemId, body) {
			return (await call<CommentResponse>("POST", `/items/${encodeURIComponent(itemId)}/comments`, { body })).comment;
		},
		async editComment(commentId, body) {
			const path = `/comments/${encodeURIComponent(commentId)}`;
			if (body === null) await call("DELETE", path);
			else await call<CommentResponse>("PATCH", path, { body });
		},
		async inbox() {
			return call<InboxResponse>("GET", "/inbox");
		},
		async markRead(ids) {
			await call<MarkReadResponse>("POST", "/events/read", { ids });
		},
		async triage(itemId, as) {
			return call<TriageResponse>("POST", `/items/${encodeURIComponent(itemId)}/triage`, as);
		},
	};
}
