import { describe, expect, it } from "vitest";
import { InboxStore, type InboxState } from "../src/inbox/inboxStore";
import type { ActivityEntry, ActivityResponse, InboxTicket } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { Conflict } from "../src/sync/compareState";

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
	comment: { id: `c${id}`, body, mentions: [], mentioned: false },
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
	urgency: "genant",
	project_id: null,
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
			const unread = feed.filter((e) => e.unread && !read.has(e.id)).length;
			return { entries, next: older.length > pageSize ? entries.at(-1)!.id : null, unread };
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

/** A conflict as the Pull works it out (only what the Inbox reads is filled). */
const conflict = (unit: Conflict["unit"], mine: string, theirs: string): Conflict =>
	({
		key: `t7f3a:${unit}`,
		kind: "task",
		id: "t7f3a",
		path: "1.meetings/m.md",
		title: "Fix heatmap",
		unit,
		held: [],
		mine: { label: mine },
		theirs: { label: theirs, by: "jmj" },
	}) as unknown as Conflict;

function storeOn(app: ReturnType<typeof fakeApp>) {
	const states: InboxState[] = [];
	const store = new InboxStore(app.remote, (s) => states.push(s));
	const ids = () => store.current.feed.map((e) => e.id);
	return { store, states, ids };
}

describe("Inbox feed", () => {
	it("shows the feed newest first, À trier and the Pull's conflicts pinned apart", async () => {
		const { store, ids } = storeOn(fakeApp([priority(5), comment(4), push(3)]));
		store.setConflicts([conflict("priority", "P2", "P1")]);
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
				title: "Conflit sur Fix heatmap",
				detail: "Priorité changée dans le coffre et dans l'app",
				by: "@jmj",
				item: { kind: "task", id: "t7f3a", title: "Fix heatmap" },
			}),
		]);
	});

	it("names an Answer's conflict, and drops a conflict once picked", async () => {
		const { store } = storeOn(fakeApp([]));
		await store.refresh();
		store.setConflicts([conflict("answer", "En cours", "Validé"), conflict("priority", "P2", "P1")]);
		expect(store.current.conflicts.map((c) => c.detail)).toEqual([
			"Réponse du Client sur un élément changé dans le coffre",
			"Priorité changée dans le coffre et dans l'app",
		]);
		store.dropConflict("t7f3a:answer");
		expect(store.current.conflicts.map((c) => c.key)).toEqual(["ct7f3a:priority"]);
	});
});

describe("Inbox feed: new Client entries", () => {
	it("are none at the first load, then the Client's entries newer than the previous load", async () => {
		const feed = [comment(4), push(3)];
		const { store } = storeOn(fakeApp(feed));
		expect(await store.refresh()).toEqual([]);
		feed.unshift(push(6), priority(5));
		feed.sort((a, b) => b.id - a.id);
		expect((await store.refresh()).map((e) => e.id)).toEqual([5]);
		expect(await store.refresh()).toEqual([]);
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

describe("Inbox feed: item filter", () => {
	it("shows one item's entries from a kanban badge, until cleared", async () => {
		const { store, ids } = storeOn(fakeApp([comment(6), priority(5), comment(4, "s2xyz"), push(3)]));
		await store.refresh();
		store.setItemFilter({ id: "t7f3a", title: "Fix heatmap" });
		expect(store.current.item).toEqual({ id: "t7f3a", title: "Fix heatmap" });
		expect(ids()).toEqual([6]);
		await store.refresh();
		expect(ids()).toEqual([6]);
		store.setItemFilter(null);
		expect(store.current.item).toBeNull();
		expect(ids()).toEqual([6, 5, 4, 3]);
	});
});

describe("Inbox feed: unread", () => {
	it("counts the unread entries and groups them by item, for the kanban badge", async () => {
		const read: ActivityEntry = { ...comment(2, "s2xyz"), unread: false };
		const { store } = storeOn(fakeApp([comment(6), priority(5), comment(4), push(3), read]));
		await store.refresh();

		expect(store.current.unread).toBe(3);
		const byItem = store.unreadByItem();
		expect([...byItem.keys()].sort()).toEqual(["p1abc", "t7f3a"]);
		expect(byItem.get("t7f3a")!.map((e) => e.id)).toEqual([6, 4]);
		expect(byItem.get("p1abc")!.map((e) => e.id)).toEqual([5]);
	});
});

describe("Inbox feed: unread total", () => {
	it("counts the app's unread total beyond the loaded page, down on Lu, to zero on Tout marquer comme lu", async () => {
		const app = fakeApp([comment(6), priority(5), comment(4), comment(2)], 2);
		const { store } = storeOn(app);
		await store.refresh();
		expect(store.current.feed).toHaveLength(2);
		expect(store.current.unread).toBe(4);

		await store.markRead(store.current.feed[0]!);
		expect(store.current.unread).toBe(3);
		await store.markAllRead();
		expect(store.current.unread).toBe(0);
	});

	it("puts the total back when the app can't be reached, and reads it again on reload", async () => {
		const app = fakeApp([comment(6), comment(4), comment(2)], 2);
		const { store } = storeOn(app);
		await store.refresh();
		app.failMarkRead();
		await store.markAllRead();
		expect(store.current.unread).toBe(3);

		await store.markRead(store.current.feed[0]!);
		await store.refresh();
		expect(store.current.unread).toBe(2);
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
