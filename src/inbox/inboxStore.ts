import type { ActivityEntry, InboxTicket, TaskType } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { Conflict } from "../sync/compareState";
import { unplacedDetail, type UnplacedItem } from "../sync/unplaced";

/** A pinned line of the Inbox view: a Ticket À trier, an Unplaced item or a conflict. */
export interface InboxEntry {
	/** Stable across reloads: `t<ticket id>`, `u<item id>` or `c<conflict key>`. */
	key: string;
	kind: "conflict" | "ticket" | "unplaced";
	/** What opening the entry goes to. */
	item: { kind: "project" | "task"; id: string; title: string };
	title: string;
	detail: string;
	/** Client who did it, ISO date. */
	by?: string;
	at?: string;
	/** `ticket`: the app type of the item to triage (bug, amelioration, idea). */
	ticketType?: TaskType;
	/** `conflict`: what its buttons settle. */
	conflict?: Conflict;
	/** `unplaced`: the Item « Insérer ici » and « Retirer de l'app » act on. */
	unplaced?: UnplacedItem;
}

export interface InboxState {
	status: "idle" | "loading" | "ready" | "error";
	/** Tickets À trier, pinned on top with their buttons. */
	toTriage: InboxEntry[];
	/** « Hors du vault », one entry each. */
	unplaced: InboxEntry[];
	/** « Hors du vault » in one entry « n éléments hors du vault » (from 5), empty for none. */
	unplacedBulk: UnplacedItem[];
	/** Conflicts the last Pull worked out, each settled by its buttons. */
	conflicts: InboxEntry[];
	/** The loaded Activity entries the item filter shows, newest first. */
	feed: ActivityEntry[];
	/** The item the feed is narrowed to (a kanban badge was clicked), null for all. */
	item: InboxItemFilter | null;
	/** The viewer's unread entries in the app, loaded or not, whatever the item filter. */
	unread: number;
	/** Older entries are left to load ("Charger plus"). */
	more: boolean;
	/** Last failure, ready for display (loading or marking read). */
	error?: string;
}

/** An item of the feed, by app id, with its title for the view. */
export type InboxItemFilter = { id: string; title: string };

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

function conflictEntry(c: Conflict): InboxEntry {
	return {
		key: `c${c.key}`,
		kind: "conflict",
		item: { kind: c.kind, id: c.id, title: c.title },
		title: `Conflit sur ${c.title}`,
		detail: c.unit === "priority" ? "Priorité changée dans le coffre et dans l'app" : "Réponse du Client sur un élément changé dans le coffre",
		...(c.theirs.by ? { by: `@${c.theirs.by}` } : {}),
		conflict: c,
	};
}

function unplacedEntry(item: UnplacedItem): InboxEntry {
	const { title } = item.fields;
	return { key: `u${item.id}`, kind: "unplaced", item: { kind: item.kind, id: item.id, title }, title, detail: unplacedDetail(item), unplaced: item };
}

/** From this many Unplaced items not yet seen in the bulk modal, they show as one entry. */
const BULK_FROM = 5;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What the Inbox view and the kanban show: the Activity feed (`GET
 * /api/activity`, paged), the Tickets À trier (`GET /api/inbox`), and the
 * Unplaced items and conflicts the last Pull worked out. Read state lives in the app, so it survives
 * restarts; marking read updates the view at once and the app right after,
 * putting the entry back on failure.
 */
export class InboxStore {
	private state: InboxState = { status: "idle", toTriage: [], unplaced: [], unplacedBulk: [], conflicts: [], feed: [], item: null, unread: 0, more: false };
	private tickets: InboxTicket[] = [];
	private entries: ActivityEntry[] = [];
	/** `before` of the next page, null when nothing is older. */
	private next: number | null = null;
	/** The app's unread total, as last read and adjusted by the marks since. */
	private unreadTotal = 0;
	private item: InboxItemFilter | null = null;
	private conflicts: Conflict[] = [];
	private unplaced: UnplacedItem[] = [];
	/** Ids of Unplaced items kept in the bulk modal: they show one entry each from then on. */
	private readonly kept = new Set<string>();
	/** Newest entry id of the previous load, null before the first one. */
	private newest: number | null = null;

	constructor(
		private readonly remote: Remote,
		private readonly onChange: (state: InboxState) => void,
	) {}

	get current(): InboxState {
		return this.state;
	}

	/**
	 * Reloads the first page of the feed and the Tickets À trier from the app.
	 * Returns the Client's entries newer than the previous load, oldest first,
	 * to toast (none at the first load, or when it fails).
	 */
	async refresh(): Promise<ActivityEntry[]> {
		const ready = this.state.status === "ready";
		this.set({ ...this.state, status: ready ? "ready" : "loading" });
		try {
			const [inbox, page] = await Promise.all([this.remote.inbox(), this.remote.activity()]);
			this.tickets = inbox.to_triage ?? [];
			this.entries = page.entries;
			this.next = page.next;
			this.unreadTotal = page.unread;
			this.set(this.build());
			const previous = this.newest;
			this.newest = page.entries[0]?.id ?? previous;
			if (previous === null) return [];
			return page.entries.filter((e) => e.id > previous && e.actor.role === "client").reverse();
		} catch (e) {
			this.set({ ...this.state, status: ready ? "ready" : "error", error: message(e) });
			return [];
		}
	}

	/** Shows the conflicts the last Pull worked out. */
	setConflicts(conflicts: Conflict[]): void {
		this.conflicts = conflicts;
		this.rebuild();
	}

	/** Shows the Unplaced items the last Pull found. */
	setUnplaced(items: UnplacedItem[]): void {
		this.unplaced = items;
		this.rebuild();
	}

	/** Takes out Unplaced items just inserted or removed. */
	dropUnplaced(ids: string[]): void {
		this.setUnplaced(this.unplaced.filter((i) => !ids.includes(i.id)));
	}

	/** Shows Unplaced items the bulk modal kept one entry each, whatever their number. */
	keepUnplaced(ids: string[]): void {
		for (const id of ids) this.kept.add(id);
		this.rebuild();
	}

	/** Takes out a conflict just settled by its buttons (`Conflict.key`). */
	dropConflict(key: string): void {
		this.setConflicts(this.conflicts.filter((c) => c.key !== key));
	}

	/** Appends the page older than the loaded entries; nothing when none is older. */
	async loadMore(): Promise<void> {
		if (this.next === null || this.state.status !== "ready") return;
		try {
			const page = await this.remote.activity(this.next);
			this.entries = [...this.entries, ...page.entries];
			this.next = page.next;
			this.unreadTotal = page.unread;
			this.set(this.build());
		} catch (e) {
			this.set({ ...this.state, error: message(e) });
		}
	}

	/** Shows only the entries of `item` (null: all of them); kept across reloads. */
	setItemFilter(item: InboxItemFilter | null): void {
		this.item = item;
		this.set({ ...this.state, item, feed: this.shown() });
	}

	/** Marks one unread entry read ("Lu"). */
	async markRead(entry: ActivityEntry): Promise<void> {
		if (entry.unread) await this.mark([entry.id], this.unreadTotal - 1, () => this.remote.markRead([entry.id]));
	}

	/** "Tout marquer comme lu": every Client event up to the newest entry loaded, older pages included. */
	async markAllRead(): Promise<void> {
		const newest = this.entries[0];
		const unread = this.entries.filter((e) => e.unread).map((e) => e.id);
		if (newest && this.unreadTotal > 0) await this.mark(unread, 0, () => this.remote.markReadUpTo(newest.id));
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

	/** Redraws from what is loaded, without asking the app. */
	rebuild(): void {
		if (this.state.status === "ready") this.set({ ...this.build(), error: this.state.error });
	}

	/** The ready state from what is loaded. */
	private build(): InboxState {
		const fresh = this.unplaced.filter((i) => !this.kept.has(i.id));
		const bulk = fresh.length >= BULK_FROM;
		return {
			status: "ready",
			toTriage: this.tickets.map(ticketEntry),
			unplaced: (bulk ? this.unplaced.filter((i) => this.kept.has(i.id)) : this.unplaced).map(unplacedEntry),
			unplacedBulk: bulk ? fresh : [],
			conflicts: this.conflicts.map(conflictEntry),
			feed: this.shown(),
			item: this.item,
			unread: this.unreadTotal,
			more: this.next !== null,
		};
	}

	/**
	 * Shows `ids` read and the total at `unreadAfter` at once, then tells the
	 * app; on failure they are unread again, the total back and the error shown.
	 */
	private async mark(ids: number[], unreadAfter: number, send: () => Promise<void>) {
		const unreadBefore = this.unreadTotal;
		this.unreadTotal = unreadAfter;
		this.setUnread(ids, false);
		try {
			await send();
		} catch (e) {
			this.unreadTotal = unreadBefore;
			this.setUnread(ids, true);
			this.set({ ...this.state, error: message(e) });
		}
	}

	private setUnread(ids: number[], unread: boolean) {
		const marked = new Set(ids);
		this.entries = this.entries.map((e) => (marked.has(e.id) ? { ...e, unread } : e));
		this.set(this.build());
	}

	/** The loaded entries the item filter keeps. */
	private shown(): ActivityEntry[] {
		const itemId = this.item?.id;
		return this.entries.filter(
			(e) => !itemId || e.item?.id === itemId,
		);
	}

	private set(state: InboxState) {
		this.state = state;
		this.onChange(state);
	}
}
