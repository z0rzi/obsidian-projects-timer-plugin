import { describe, expect, it } from "vitest";
import { InboxStore, type InboxState } from "../src/inbox/inboxStore";
import type { ActivityEntry, ActivityResponse, InboxTicket } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { PullConflict } from "../src/sync/pullPriority";

const JMJ: ActivityEntry["actor"] = { email: "jmj@edf.fr", handle: "jmj", role: "client" };
const ME: ActivityEntry["actor"] = { email: "baptiste@example.fr", handle: "baptiste", role: "developer" };

const comment = (id: number, itemId = "t7f3a", body = "Ça bloque"): ActivityEntry => ({
	id,
	at: `2026-10-20T10:${String(id).padStart(2, "0")}:00.000Z`,
	actor: JMJ,
	origin: "site",
	type: "comment.created",
	label: "Commentaire",
	item: { kind: "task", id: itemId, title: "Fix heatmap" },
	comment: { id: `c${id}`, body, mentions: [] },
	unread: true,
});

const priority = (id: number): ActivityEntry => ({
	id,
	at: `2026-10-20T10:${String(id).padStart(2, "0")}:00.000Z`,
	actor: JMJ,
	origin: "site",
	type: "item.updated",
	label: "Priorité : P3 → P1",
	item: { kind: "project", id: "p1abc", title: "Widget" },
	field: "priority",
	from: 3,
	to: 1,
	unread: true,
});

const push = (id: number): ActivityEntry => ({
	id,
	at: `2026-10-20T10:${String(id).padStart(2, "0")}:00.000Z`,
	actor: ME,
	origin: "push",
	type: "push.completed",
	label: "Push : 12 changements",
	push: { applied: 12, rejected: 0 },
	unread: false,
});

const ticket: InboxTicket = {
	id: "t9bug",
	type: "bug",
	title: "Heatmap vide",
	description: "Rien ne s'affiche",
	created_at: "2026-10-20T10:00:00.000Z",
	author_email: "jmj@edf.fr",
};

/**
 * An app serving the feed newest first in pages of `pageSize` entries
 * (`next` = oldest id of the page), keeping read marks like
 * `POST /api/events/read`.
 */
function fakeApp(feed: ActivityEntry[], pageSize = 10) {
	const read = new Set<number>();
	const marked: (number[] | { upto: number })[] = [];
	const asked: (number | undefined)[] = [];
	let failNext = false;
	const fail = () => {
		if (!failNext) return;
		failNext = false;
		throw new Error("Suivi unreachable");
	};
	const remote = {
		async inbox() {
			return { notifications: [], to_triage: [ticket] };
		},
		async activity(before?: number): Promise<ActivityResponse> {
			asked.push(before);
			const older = feed.filter((e) => before === undefined || e.id < before);
			const entries = older.slice(0, pageSize).map((e) => ({ ...e, unread: e.unread && !read.has(e.id) }));
			return { entries, next: older.length > pageSize ? entries.at(-1)!.id : null };
		},
		async markRead(ids: number[]) {
			fail();
			marked.push(ids);
			ids.forEach((id) => read.add(id));
		},
		async markReadUpTo(upto: number) {
			fail();
			marked.push({ upto });
			feed.filter((e) => e.id <= upto && e.actor.role === "client").forEach((e) => read.add(e.id));
		},
	} as unknown as Remote;
	return { remote, marked, asked, failMarkRead: () => (failNext = true) };
}

function storeOn(app: ReturnType<typeof fakeApp>, conflicts: Record<string, PullConflict> = {}) {
	const states: InboxState[] = [];
	const store = new InboxStore(app.remote, () => conflicts, (s) => states.push(s));
	const ids = () => store.current.feed.map((e) => e.id);
	return { store, states, ids };
}

describe("Inbox feed", () => {
	it("shows the feed newest first, À trier and Pull conflicts pinned apart", async () => {
		const conflict: PullConflict = {
			kind: "task",
			id: "t7f3a",
			field: "priority",
			path: "2.projects/Widget.md",
			title: "Fix heatmap",
			remote: 1,
		};
		const { store, ids } = storeOn(fakeApp([priority(5), comment(4), push(3)]), { "t7f3a:priority": conflict });
		await store.refresh();

		expect(store.current.status).toBe("ready");
		expect(ids()).toEqual([5, 4, 3]);
		expect(store.current.toTriage).toEqual([
			expect.objectContaining({
				kind: "ticket",
				ticketType: "bug",
				title: "Bug: Heatmap vide",
				item: { kind: "task", id: "t9bug", title: "Heatmap vide" },
			}),
		]);
		expect(store.current.conflicts).toEqual([
			expect.objectContaining({
				kind: "conflict",
				title: "Conflict on Fix heatmap",
				detail: "Suivi has P1, you changed it too: pick in Push to Suivi",
				item: { kind: "task", id: "t7f3a", title: "Fix heatmap" },
			}),
		]);
	});
});

describe("Inbox feed: paging", () => {
	it("loads older pages on demand, from the oldest entry loaded, until there is nothing older", async () => {
		const app = fakeApp([comment(5), comment(4), push(3), priority(2), comment(1)], 2);
		const { store, ids } = storeOn(app);
		await store.refresh();
		expect(ids()).toEqual([5, 4]);
		expect(store.current.more).toBe(true);

		await store.loadMore();
		expect(ids()).toEqual([5, 4, 3, 2]);
		await store.loadMore();
		expect(ids()).toEqual([5, 4, 3, 2, 1]);
		expect(store.current.more).toBe(false);
		await store.loadMore();
		expect(app.asked).toEqual([undefined, 4, 2]);
	});

	it("reloads the first page only", async () => {
		const app = fakeApp([comment(5), comment(4), push(3)], 2);
		const { store, ids } = storeOn(app);
		await store.refresh();
		await store.loadMore();
		await store.refresh();
		expect(ids()).toEqual([5, 4]);
		expect(store.current.more).toBe(true);
	});
});

describe("Inbox feed: filter", () => {
	it("shows JMJ's entries under JMJ, the Developer's (Push lines included) under Moi, all under Tous", async () => {
		const mine: ActivityEntry = { ...comment(6), actor: ME, origin: "api", unread: false };
		const { store, ids } = storeOn(fakeApp([mine, priority(5), comment(4), push(3)]));
		await store.refresh();
		expect(store.current.filter).toBe("tous");
		expect(ids()).toEqual([6, 5, 4, 3]);

		store.setFilter("jmj");
		expect(ids()).toEqual([5, 4]);
		store.setFilter("moi");
		expect(ids()).toEqual([6, 3]);
	});

	it("keeps the filter across a reload", async () => {
		const { store, ids } = storeOn(fakeApp([priority(5), push(3)]));
		await store.refresh();
		store.setFilter("moi");
		await store.refresh();
		expect(store.current.filter).toBe("moi");
		expect(ids()).toEqual([3]);
	});
});

describe("Inbox feed: unread", () => {
	it("counts the unread entries and groups them by item, for the kanban badge", async () => {
		const read: ActivityEntry = { ...comment(2, "s2xyz"), unread: false };
		const { store } = storeOn(fakeApp([comment(6), priority(5), comment(4), push(3), read]));
		await store.refresh();
		store.setFilter("moi");

		expect(store.current.unread).toBe(3);
		const byItem = store.unreadByItem();
		expect([...byItem.keys()].sort()).toEqual(["p1abc", "t7f3a"]);
		expect(byItem.get("t7f3a")!.map((e) => e.id)).toEqual([6, 4]);
		expect(byItem.get("p1abc")!.map((e) => e.id)).toEqual([5]);
	});
});

describe("Inbox feed: marking read", () => {
	const unreadIds = (store: InboxStore) => store.current.feed.filter((e) => e.unread).map((e) => e.id);

	it("marks one entry read in the app, which keeps it as read after a reload", async () => {
		const app = fakeApp([comment(6), priority(5), comment(4)]);
		const { store } = storeOn(app);
		await store.refresh();

		await store.markRead(store.current.feed[2]!);
		expect(app.marked).toEqual([[4]]);
		expect(unreadIds(store)).toEqual([6, 5]);
		expect(store.current.unread).toBe(2);
		expect(store.unreadByItem().get("t7f3a")!.map((e) => e.id)).toEqual([6]);

		// A new session (Obsidian restart) reads the app's state again.
		const again = storeOn(app);
		await again.store.refresh();
		expect(unreadIds(again.store)).toEqual([6, 5]);
	});

	it("marks all read up to the newest entry loaded", async () => {
		const app = fakeApp([push(7), comment(6), priority(5), comment(4)], 2);
		const { store } = storeOn(app);
		await store.refresh();
		await store.markAllRead();
		expect(app.marked).toEqual([{ upto: 7 }]);
		expect(store.current.unread).toBe(0);
		expect(store.unreadByItem().size).toBe(0);
	});

	it("puts the entry back unread and shows the error when the app can't be reached", async () => {
		const app = fakeApp([comment(6), comment(4)]);
		const { store } = storeOn(app);
		await store.refresh();
		app.failMarkRead();
		await store.markRead(store.current.feed[0]!);
		expect(unreadIds(store)).toEqual([6, 4]);
		expect(store.current.error).toMatch(/unreachable/);

		app.failMarkRead();
		await store.markAllRead();
		expect(unreadIds(store)).toEqual([6, 4]);
		expect(app.marked).toEqual([]);
	});
});
