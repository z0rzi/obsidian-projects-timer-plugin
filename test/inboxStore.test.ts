import { describe, expect, it } from "vitest";
import { InboxStore, type InboxState } from "../src/inbox/inboxStore";
import type { InboxNotification } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { PullConflict } from "../src/sync/pullPriority";

const comment = (id: number, itemId = "t7f3a", body = "Ça bloque"): InboxNotification => ({
	id,
	at: "2026-10-20T10:00:00.000Z",
	actor_email: "jmj@edf.fr",
	type: "comment.created",
	item_id: itemId,
	item_kind: "task",
	item_title: "Fix heatmap",
	comment_id: `c${id}`,
	body,
});

const priority = (id: number, from: number | null, to: number): InboxNotification => ({
	id,
	at: "2026-10-20T10:00:00.000Z",
	actor_email: "jmj@edf.fr",
	type: "item.updated",
	item_id: "p1abc",
	item_kind: "project",
	item_title: "Widget",
	field: "priority",
	from,
	to,
});

/** An app keeping read marks, like GET /api/inbox + POST /api/events/read. */
function fakeApp(notifications: InboxNotification[]) {
	const read = new Set<number>();
	const marked: number[][] = [];
	let failNext = false;
	const remote = {
		async inbox() {
			return { notifications: notifications.filter((n) => !read.has(n.id)) };
		},
		async markRead(ids: number[]) {
			if (failNext) {
				failNext = false;
				throw new Error("Suivi unreachable");
			}
			marked.push(ids);
			ids.forEach((id) => read.add(id));
		},
	} as unknown as Remote;
	return { remote, marked, failMarkRead: () => (failNext = true) };
}

function storeOn(app: ReturnType<typeof fakeApp>, conflicts: Record<string, PullConflict> = {}) {
	const states: InboxState[] = [];
	const store = new InboxStore(app.remote, () => conflicts, (s) => states.push(s));
	const entries = () => store.current.sections.flatMap((s) => s.entries);
	return { store, states, entries };
}

describe("Inbox", () => {
	it("lists Client comments and priority changes as Notifications", async () => {
		const { store, entries } = storeOn(fakeApp([comment(4), priority(5, 3, 1)]));
		await store.refresh();

		expect(store.current.status).toBe("ready");
		expect(store.current.sections.map((s) => s.title)).toEqual(["À trier", "Notifications"]);
		expect(entries()).toEqual([
			expect.objectContaining({
				kind: "comment",
				title: "Comment on Fix heatmap",
				detail: "Ça bloque",
				by: "jmj@edf.fr",
				item: { kind: "task", id: "t7f3a", title: "Fix heatmap" },
				eventIds: [4],
			}),
			expect.objectContaining({
				kind: "priority",
				title: "Priority of Widget",
				detail: "P3 → P1",
				item: { kind: "project", id: "p1abc", title: "Widget" },
				eventIds: [5],
			}),
		]);
	});

	it("says when an inheriting step got its own priority", async () => {
		const { store, entries } = storeOn(fakeApp([priority(5, null, 2)]));
		await store.refresh();
		expect(entries()[0]!.detail).toBe("inherited → P2");
	});

	it("knows which items have unread comments, for the kanban dot", async () => {
		const { store } = storeOn(fakeApp([comment(4, "t7f3a"), comment(6, "s2xyz"), priority(5, 3, 1)]));
		await store.refresh();
		expect([...store.unreadComments()].sort()).toEqual(["s2xyz", "t7f3a"]);
	});

	it("marks one entry read in the app and drops it, also after a reload", async () => {
		const app = fakeApp([comment(4), priority(5, 3, 1)]);
		const { store, entries } = storeOn(app);
		await store.refresh();

		await store.markRead(entries()[0]!);
		expect(app.marked).toEqual([[4]]);
		expect(entries().map((e) => e.eventIds)).toEqual([[5]]);
		expect(store.unreadComments().size).toBe(0);

		// A new session (Obsidian restart) reads the app's state again.
		const again = storeOn(app);
		await again.store.refresh();
		expect(again.entries().map((e) => e.eventIds)).toEqual([[5]]);
	});

	it("marks all read at once", async () => {
		const app = fakeApp([comment(4), priority(5, 3, 1)]);
		const { store, entries } = storeOn(app);
		await store.refresh();
		await store.markAllRead();
		expect(app.marked).toEqual([[4, 5]]);
		expect(entries()).toEqual([]);
	});

	it("keeps the entry and shows the error when the app can't be reached", async () => {
		const app = fakeApp([comment(4)]);
		const { store, entries } = storeOn(app);
		await store.refresh();
		app.failMarkRead();
		await store.markRead(entries()[0]!);
		expect(entries()).toHaveLength(1);
		expect(store.current.error).toMatch(/unreachable/);
	});

	it("shows Pull conflicts, which settle in Push rather than by marking read", async () => {
		const app = fakeApp([comment(4)]);
		const conflict: PullConflict = {
			kind: "task",
			id: "t7f3a",
			field: "priority",
			path: "2.projects/Widget.md",
			title: "Fix heatmap",
			remote: 1,
		};
		const { store, entries } = storeOn(app, { "t7f3a:priority": conflict });
		await store.refresh();

		expect(entries()).toContainEqual(
			expect.objectContaining({
				kind: "conflict",
				title: "Conflict on Fix heatmap",
				detail: "Suivi has P1, you changed it too: pick in Push to Suivi",
				item: { kind: "task", id: "t7f3a", title: "Fix heatmap" },
				eventIds: [],
			}),
		);
		await store.markAllRead();
		expect(app.marked).toEqual([[4]]);
		expect(entries().map((e) => e.kind)).toEqual(["conflict"]);
	});
});
