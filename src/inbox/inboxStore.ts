import type { ActivityEntry, InboxTicket, TaskType } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { PullConflict } from "../sync/pullPriority";

/** A pinned line of the Inbox view: a Ticket À trier or a Pull conflict. */
export interface InboxEntry {
	/** Stable across reloads: `t<ticket id>` or `c<conflict key>`. */
	key: string;
	kind: "conflict" | "ticket";
	/** What opening the entry goes to. */
	item: { kind: "project" | "task" | "review"; id: string; title: string };
	title: string;
	detail: string;
	/** Client who did it, ISO date. */
	by?: string;
	at?: string;
	/** `ticket`: the app type of the item to triage (bug, amelioration, idea). */
	ticketType?: TaskType;
}

/** Whose entries the feed shows: everyone's, the Client's, the Developer's. */
export type InboxFilter = "tous" | "jmj" | "moi";

const FILTER_ROLES: Record<InboxFilter, ActivityEntry["actor"]["role"] | null> = {
	tous: null,
	jmj: "client",
	moi: "developer",
};

export interface InboxState {
	status: "idle" | "loading" | "ready" | "error";
	/** Tickets À trier, pinned on top with their buttons. */
	toTriage: InboxEntry[];
	/** Pull conflicts, settled in Push. */
	conflicts: InboxEntry[];
	/** The loaded Activity entries the filter shows, newest first. */
	feed: ActivityEntry[];
	filter: InboxFilter;
	/** The item the feed is narrowed to (a kanban badge was clicked), null for all. */
	item: InboxItemFilter | null;
	/** Unread entries among those loaded, whatever the filter. */
	unread: number;
	/** Older entries are left to load ("Charger plus"). */
	more: boolean;
	/** Last failure, ready for display (loading or marking read). */
	error?: string;
}

/** An item of the feed, by app id, with its title for the view. */
export type InboxItemFilter = { id: string; title: string };

type Conflicts = () => Record<string, PullConflict> | undefined;

const p = (v: unknown) => (typeof v === "number" ? `P${v}` : "inherited");

const TICKET_LABELS: Partial<Record<TaskType, string>> = {
	bug: "Bug",
	amelioration: "Amélioration",
	idea: "Idée",
};

function ticketEntry(t: InboxTicket): InboxEntry {
	return {
		key: `t${t.id}`,
		kind: "ticket",
		ticketType: t.type,
		item: { kind: "task", id: t.id, title: t.title },
		title: `${TICKET_LABELS[t.type] ?? t.type}: ${t.title}`,
		detail: t.description,
		by: t.author_email,
		at: t.created_at,
	};
}

function conflictEntry(c: PullConflict): InboxEntry {
	return {
		key: `c${c.id}:${c.field}`,
		kind: "conflict",
		item: { kind: c.kind, id: c.id, title: c.title },
		title: `Conflict on ${c.title}`,
		detail: `Suivi has ${c.field === "status" ? "Terminé (Review validée)" : p(c.remote)}, you changed it too: pick in Push to Suivi`,
	};
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What the Inbox view and the kanban show: the Activity feed (`GET
 * /api/activity`, paged), the Tickets À trier (`GET /api/inbox`) and the
 * local Pull conflicts. Read state lives in the app, so it survives
 * restarts; marking read updates the view at once and the app right after,
 * putting the entry back on failure.
 */
export class InboxStore {
	private state: InboxState = { status: "idle", toTriage: [], conflicts: [], feed: [], filter: "tous", item: null, unread: 0, more: false };
	private tickets: InboxTicket[] = [];
	private entries: ActivityEntry[] = [];
	/** `before` of the next page, null when nothing is older. */
	private next: number | null = null;
	private filter: InboxFilter = "tous";
	private item: InboxItemFilter | null = null;

	constructor(
		private readonly remote: Remote,
		private readonly conflicts: Conflicts,
		private readonly onChange: (state: InboxState) => void,
	) {}

	get current(): InboxState {
		return this.state;
	}

	/** Reloads the first page of the feed and the Tickets À trier from the app. */
	async refresh(): Promise<void> {
		const ready = this.state.status === "ready";
		this.set({ ...this.state, status: ready ? "ready" : "loading" });
		try {
			const [inbox, page] = await Promise.all([this.remote.inbox(), this.remote.activity()]);
			this.tickets = inbox.to_triage ?? [];
			this.entries = page.entries;
			this.next = page.next;
			this.set(this.build());
		} catch (e) {
			this.set({ ...this.state, status: ready ? "ready" : "error", error: message(e) });
		}
	}

	/** Appends the page older than the loaded entries; nothing when none is older. */
	async loadMore(): Promise<void> {
		if (this.next === null || this.state.status !== "ready") return;
		try {
			const page = await this.remote.activity(this.next);
			this.entries = [...this.entries, ...page.entries];
			this.next = page.next;
			this.set(this.build());
		} catch (e) {
			this.set({ ...this.state, error: message(e) });
		}
	}

	/** Shows only the entries of `filter`; kept across reloads. */
	setFilter(filter: InboxFilter): void {
		this.filter = filter;
		this.set({ ...this.state, filter, feed: this.shown() });
	}

	/** Shows only the entries of `item` (null: all of them); kept across reloads, combined with the filter. */
	setItemFilter(item: InboxItemFilter | null): void {
		this.item = item;
		this.set({ ...this.state, item, feed: this.shown() });
	}

	/** Marks one unread entry read ("Lu"). */
	async markRead(entry: ActivityEntry): Promise<void> {
		if (entry.unread) await this.mark([entry.id], () => this.remote.markRead([entry.id]));
	}

	/** "Tout marquer comme lu": every Client event up to the newest entry loaded. */
	async markAllRead(): Promise<void> {
		const newest = this.entries[0];
		const unread = this.entries.filter((e) => e.unread).map((e) => e.id);
		if (newest && unread.length) await this.mark(unread, () => this.remote.markReadUpTo(newest.id));
	}

	/** The loaded unread entries by id of the item they concern, newest first. */
	unreadByItem(): Map<string, ActivityEntry[]> {
		const byItem = new Map<string, ActivityEntry[]>();
		for (const entry of this.entries) {
			if (!entry.unread || !entry.item) continue;
			byItem.set(entry.item.id, [...(byItem.get(entry.item.id) ?? []), entry]);
		}
		return byItem;
	}

	/** Re-reads the local conflicts (after a Pull or Push) without asking the app. */
	rebuild(): void {
		if (this.state.status === "ready") this.set({ ...this.build(), error: this.state.error });
	}

	/** The ready state from what is loaded. */
	private build(): InboxState {
		return {
			status: "ready",
			toTriage: this.tickets.map(ticketEntry),
			conflicts: Object.values(this.conflicts() ?? {}).map(conflictEntry),
			feed: this.shown(),
			filter: this.filter,
			item: this.item,
			unread: this.entries.filter((e) => e.unread).length,
			more: this.next !== null,
		};
	}

	/** Shows `ids` read at once, then tells the app; on failure they are unread again and the error shown. */
	private async mark(ids: number[], send: () => Promise<void>) {
		this.setUnread(ids, false);
		try {
			await send();
		} catch (e) {
			this.setUnread(ids, true);
			this.set({ ...this.state, error: message(e) });
		}
	}

	private setUnread(ids: number[], unread: boolean) {
		const marked = new Set(ids);
		this.entries = this.entries.map((e) => (marked.has(e.id) ? { ...e, unread } : e));
		this.set(this.build());
	}

	/** The loaded entries the filter and the item filter keep. */
	private shown(): ActivityEntry[] {
		const role = FILTER_ROLES[this.filter];
		const itemId = this.item?.id;
		return this.entries.filter((e) => (!role || e.actor.role === role) && (!itemId || e.item?.id === itemId));
	}

	private set(state: InboxState) {
		this.state = state;
		this.onChange(state);
	}
}
