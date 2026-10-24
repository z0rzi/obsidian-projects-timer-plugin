import type {
	AcknowledgedItem,
	AcknowledgeResponse,
	ActivityResponse,
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
	ItemState,
	StateResponse,
	UploadResponse,
	TriageRequest,
	TriageResponse,
} from "./api";

/**
 * The plugin's only door to the Client app. Parser, kanban, Inbox and Push
 * screen depend on this interface, never on HTTP.
 */
export interface Remote {
	push(changes: PushChange[]): Promise<PushResult[]>;
	/** Every Project and Task of the app, archived ones included, with its base. */
	state(): Promise<ItemState[]>;
	/** Sets the base of Items the vault now agrees on (all or nothing). */
	acknowledge(items: AcknowledgedItem[]): Promise<void>;
	/** Thread of a Project or Task, oldest first. */
	comments(itemId: string): Promise<Comment[]>;
	/** Adds a comment to an item's thread. */
	comment(itemId: string, body: string): Promise<Comment>;
	/** Changes one's own comment; `null` deletes it. */
	editComment(commentId: string, body: string | null): Promise<void>;
	/** The Developer's Inbox: unread Notifications (read state lives in the app). */
	inbox(): Promise<InboxResponse>;
	/** Marks the events of Inbox entries read. */
	markRead(eventIds: number[]): Promise<void>;
	/** A page of the Activity feed: entries older than `before` (absent = the newest), spanning `days` (app default 30). */
	activity(before?: number, days?: number): Promise<ActivityResponse>;
	/** Marks every Client event up to `id` included read. */
	markReadUpTo(id: number): Promise<void>;
	/** Uploads an image (PNG, JPEG, GIF, WebP); returns its path in the app (`/uploads/<name>`), the existing one when the app already has that content. */
	upload(data: ArrayBuffer, name: string): Promise<string>;
	/**
	 * An uploaded image (`/uploads/<name>`, as comment bodies hold it), fetched
	 * with the token: uploads need a session or token, so the panel shows a local copy.
	 */
	image(path: string): Promise<{ data: ArrayBuffer; type: string }>;
	/** Turns an item À trier into a Task; returns its shared fields as the app now has them. */
	triage(itemId: string, as: TriageRequest): Promise<TriageResponse>;
	/** Checks the URL and the token with a cheap authenticated call (an empty page of events). */
	checkConnection(): Promise<void>;
}

export type RemoteErrorKind = "config" | "auth" | "network" | "server";

/**
 * A call that failed as a whole; `message` is ready for a Notice. `status` is the
 * HTTP status the app answered, `detail` why the app couldn't be reached.
 */
export class RemoteError extends Error {
	constructor(
		readonly kind: RemoteErrorKind,
		message: string,
		readonly status?: number,
		readonly detail?: string,
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
	body?: string | ArrayBuffer;
}

/** One HTTP response. `json` is the parsed body, or null if it isn't JSON; binary bodies come as `arrayBuffer`. */
export interface TransportResponse {
	status: number;
	json: unknown;
	arrayBuffer?: ArrayBuffer;
	contentType?: string;
}

/** Sends one HTTP request. */
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** An upload path as the app hands it out: `/uploads/<random>.<ext>`. */
const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

export interface RemoteConfig {
	/** App URL, e.g. `https://suivi.mbz-dev.com`. */
	url: string;
	/** Personal API token from the app's Paramètres page. */
	token: string;
}

/** The `edf-suivi` HTTP API. */
export function createHttpRemote(config: RemoteConfig, transport: Transport): Remote {
	/** Sends one request to `/api<path>`; throws a RemoteError unless it got a 2xx. */
	async function send(method: HttpMethod, path: string, body?: unknown, raw?: Multipart): Promise<TransportResponse> {
		const base = config.url.trim().replace(/\/+$/, "");
		const token = config.token.trim();
		if (!base || !token) {
			throw new RemoteError("config", "Suivi: set the app URL and API token in the plugin settings.");
		}
		let res: TransportResponse;
		try {
			res = await transport({
				url: `${base}/api${path}`,
				method,
				headers: { Authorization: `Bearer ${token}`, "Content-Type": raw?.contentType ?? "application/json" },
				body: raw ? raw.body : body === undefined ? undefined : JSON.stringify(body),
			});
		} catch (e) {
			const detail = (e as Error).message;
			throw new RemoteError("network", `Suivi unreachable at ${base}: ${detail}`, undefined, detail);
		}
		const error = (res.json as Partial<ApiError> | null)?.error;
		if (res.status === 401 || res.status === 403) {
			throw new RemoteError(
				"auth",
				`Suivi rejected the API token${error ? ` (${error})` : ""}. Check it in the plugin settings.`,
				res.status,
			);
		}
		if (res.status < 200 || res.status >= 300) {
			throw new RemoteError("server", `Suivi error (HTTP ${res.status})${error ? `: ${error}` : ""}`, res.status);
		}
		return res;
	}

	async function call<T>(method: HttpMethod, path: string, body?: unknown, raw?: Multipart): Promise<T> {
		const res = await send(method, path, body, raw);
		if (res.json === null) throw new RemoteError("server", `Suivi error (HTTP ${res.status}): not JSON`);
		return res.json as T;
	}

	return {
		async push(changes) {
			return (await call<PushResponse>("POST", "/push", { changes })).results;
		},
		async state() {
			return (await call<StateResponse>("GET", "/state")).items;
		},
		async acknowledge(items) {
			await call<AcknowledgeResponse>("POST", "/state/acknowledge", { items });
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
		async activity(before, days) {
			const query = [before === undefined ? "" : `before=${before}`, days === undefined ? "" : `days=${days}`];
			const search = query.filter(Boolean).join("&");
			return call<ActivityResponse>("GET", `/activity${search ? `?${search}` : ""}`);
		},
		async markReadUpTo(id) {
			await call<MarkReadResponse>("POST", "/events/read", { upto: id });
		},
		async upload(data, name) {
			return (await call<UploadResponse>("POST", "/uploads", undefined, multipart(data, name))).url;
		},
		async image(path) {
			if (!UPLOAD_PATH.test(path)) throw new RemoteError("config", `Not a Suivi upload: ${path}`);
			const res = await send("GET", path);
			if (!res.arrayBuffer || !res.contentType?.startsWith("image/")) {
				throw new RemoteError("server", `Suivi sent no image for ${path}`);
			}
			return { data: res.arrayBuffer, type: res.contentType };
		},
		async triage(itemId, as) {
			return call<TriageResponse>("POST", `/items/${encodeURIComponent(itemId)}/triage`, as);
		},
		async checkConnection() {
			await call<EventsResponse>("GET", `/events?since=${Number.MAX_SAFE_INTEGER}`);
		},
	};
}

interface Multipart {
	contentType: string;
	body: ArrayBuffer;
}

const MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

/** A `multipart/form-data` body with one field `file` (built by hand: `requestUrl` takes no FormData). */
function multipart(data: ArrayBuffer, name: string): Multipart {
	const boundary = `----suivi${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
	const type = MIME[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
	const safeName = name.replace(/["\r\n\\]/g, "_");
	const enc = new TextEncoder();
	const head = enc.encode(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${type}\r\n\r\n`,
	);
	const tail = enc.encode(`\r\n--${boundary}--\r\n`);
	const body = new Uint8Array(head.length + data.byteLength + tail.length);
	body.set(head, 0);
	body.set(new Uint8Array(data), head.length);
	body.set(tail, head.length + data.byteLength);
	return { contentType: `multipart/form-data; boundary=${boundary}`, body: body.buffer };
}
