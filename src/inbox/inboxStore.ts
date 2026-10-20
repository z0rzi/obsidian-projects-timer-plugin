import type { InboxNotification, InboxResponse, InboxTicket, TaskType } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { PullConflict } from "../sync/pullPriority";

/** One line of the Inbox view. */
export interface InboxEntry {
	/** Stable across reloads: `e<event id>` or `c<conflict key>`. */
	key: string;
	kind: "comment" | "priority" | "conflict" | "ticket" | "answer";
	/** What opening the entry goes to. */
	item: { kind: "project" | "task" | "review"; id: string; title: string };
	title: string;
	detail: string;
	/** Client who did it, ISO date. */
	by?: string;
	at?: string;
	/** Events marked read with the entry; empty = it can't be (a conflict settles in Push, a ticket by Triage). */
	eventIds: number[];
	/** `ticket`: the app type of the item to triage (bug, amelioration). */
	ticketType?: TaskType;
}

export interface InboxSection {
	id: string;
	title: string;
	entries: InboxEntry[];
}

export interface InboxState {
	status: "idle" | "loading" | "ready" | "error";
	/** In display order; empty sections are kept (the view says "Nothing new"). */
	sections: InboxSection[];
	/** Last failure, ready for display (loading or marking read). */
	error?: string;
}

type Conflicts = () => Record<string, PullConflict> | undefined;

/** Builds the sections from the app's answer and the local conflicts, in display order. */
const SECTIONS: ((inbox: InboxResponse, conflicts: PullConflict[]) => InboxSection)[] = [
	(inbox) => ({ id: "to-triage", title: "À trier", entries: (inbox.to_triage ?? []).map(ticketEntry) }),
	(inbox, conflicts) => ({
		id: "notifications",
		title: "Notifications",
		entries: [...inbox.notifications.map(notificationEntry), ...conflicts.map(conflictEntry)],
	}),
];

const p = (v: unknown) => (typeof v === "number" ? `P${v}` : "inherited");

function notificationEntry(n: InboxNotification): InboxEntry {
	const item = { kind: n.item_kind, id: n.item_id, title: n.item_title };
	const base = { key: `e${n.id}`, item, by: n.actor_email, at: n.at, eventIds: [n.id] };
	if (n.type === "comment.created") {
		return { ...base, kind: "comment", title: `Comment on ${n.item_title}`, detail: n.body ?? "" };
	}
	if (n.type === "review.answered") {
		const answer = n.answer === "valide" ? "Validé" : "À reprendre";
		const task = n.answer === "valide" ? "its Task is done" : "its Task is back to P0";
		return { ...base, kind: "answer", title: `Review ${n.item_title}: ${answer}`, detail: task };
	}
	return { ...base, kind: "priority", title: `Priority of ${n.item_title}`, detail: `${p(n.from)} → ${p(n.to)}` };
}

const TICKET_LABELS: Partial<Record<TaskType, string>> = { bug: "Bug", amelioration: "Amélioration" };

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
		eventIds: [],
	};
}

function conflictEntry(c: PullConflict): InboxEntry {
	return {
		key: `c${c.id}:${c.field}`,
		kind: "conflict",
		item: { kind: c.kind, id: c.id, title: c.title },
		title: `Conflict on ${c.title}`,
		detail: `Suivi has ${p(c.remote)}, you changed it too: pick in Push to Suivi`,
		eventIds: [],
	};
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What the Inbox view and the kanban dots show. Unread state lives in the
 * app (`GET /api/inbox`), so it survives restarts; marking read updates the
 * view at once and the app right after, putting the entry back on failure.
 */
export class InboxStore {
	private state: InboxState = { status: "idle", sections: [] };
	private notifications: InboxNotification[] = [];
	private inbox: InboxResponse = { notifications: [], to_triage: [] };

	constructor(
		private readonly remote: Remote,
		private readonly conflicts: Conflicts,
		private readonly onChange: (state: InboxState) => void,
	) {}

	get current(): InboxState {
		return this.state;
	}

	/** Reloads from the app. */
	async refresh(): Promise<void> {
		this.set({ ...this.state, status: this.state.status === "ready" ? "ready" : "loading" });
		try {
			this.inbox = await this.remote.inbox();
			this.notifications = this.inbox.notifications;
			this.set({ status: "ready", sections: this.build() });
		} catch (e) {
			this.set({ ...this.state, status: this.state.status === "ready" ? "ready" : "error", error: message(e) });
		}
	}

	/** Re-reads the local conflicts (after a Pull or Push) without asking the app. */
	rebuild(): void {
		if (this.state.status === "ready") this.set({ ...this.state, sections: this.build() });
	}

	async markRead(entry: InboxEntry): Promise<void> {
		await this.mark(entry.eventIds);
	}

	async markAllRead(): Promise<void> {
		await this.mark(this.notifications.map((n) => n.id));
	}

	/** Ids of the items with an unread Client comment. */
	unreadComments(): Set<string> {
		return new Set(this.notifications.filter((n) => n.type === "comment.created").map((n) => n.item_id));
	}

	private async mark(ids: number[]) {
		if (ids.length === 0) return;
		const before = this.notifications;
		const read = new Set(ids);
		this.notifications = before.filter((n) => !read.has(n.id));
		this.set({ status: "ready", sections: this.build() });
		try {
			await this.remote.markRead(ids);
		} catch (e) {
			const kept = new Set(this.notifications.map((n) => n.id));
			this.notifications = before.filter((n) => kept.has(n.id) || read.has(n.id));
			this.set({ status: "ready", sections: this.build(), error: message(e) });
		}
	}

	private build(): InboxSection[] {
		const inbox = { ...this.inbox, notifications: this.notifications };
		const conflicts = Object.values(this.conflicts() ?? {});
		return SECTIONS.map((section) => section(inbox, conflicts));
	}

	private set(state: InboxState) {
		this.state = state;
		this.onChange(state);
	}
}
