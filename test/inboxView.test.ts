import { describe, expect, it, vi } from "vitest";
import { ItemView } from "obsidian";
import { feedLines, nothingToHandle, InboxView } from "../src/views/InboxView";
import type { InboxEntry, InboxState, InboxStore } from "../src/inbox/inboxStore";
import type { ActivityEntry } from "../src/remote/api";

const entry = (id: number, unread: boolean): ActivityEntry => ({
	id,
	at: `2026-10-20T10:${String(id).padStart(2, "0")}:00.000Z`,
	actor: { email: "jmj@edf.fr", handle: "jmj", role: "client" },
	origin: "site",
	type: "comment.created",
	label: "Commentaire",
	item: { kind: "task", id: "t7f3a", title: "Fix heatmap" },
	unread,
});

const ticket: InboxEntry = {
	key: "t9",
	kind: "ticket",
	item: { kind: "task", id: "t9", title: "Export" },
	title: "Bug: Export",
	detail: "",
};

const state = (patch: Partial<InboxState>): InboxState => ({
	status: "ready",
	toTriage: [],
	conflicts: [],
	feed: [],
	filter: "all",
	item: null,
	unread: 0,
	more: false,
	...patch,
});

describe("InboxView", () => {
	it("keeps Obsidian's View.open, so opening the leaf does not run the entry-click callback", async () => {
		const openItem = vi.fn();
		const view = new InboxView(
			{} as never,
			{} as InboxStore,
			() => () => {},
			openItem,
			() => "",
			async () => null as never,
		);
		expect(Object.prototype.hasOwnProperty.call(view, "open")).toBe(false);
		expect(view.open).toBe(ItemView.prototype.open);

		const containerEl = {};
		await view.open(containerEl as never);
		expect(openItem).not.toHaveBeenCalled();
	});

	it("leaves read entries out of the Inbox", () => {
		const lines = feedLines([entry(3, true), entry(2, false), entry(1, true)], "inbox");
		expect(lines.map((l) => [l.entry.id, l.dimmed])).toEqual([
			[3, false],
			[1, false],
		]);
	});

	it("lists every entry in the Activity, the read ones dimmed", () => {
		const lines = feedLines([entry(3, true), entry(2, false)], "activity");
		expect(lines.map((l) => [l.entry.id, l.dimmed])).toEqual([
			[3, false],
			[2, true],
		]);
	});

	it("has nothing to handle once every entry is read and nothing is pinned", () => {
		expect(nothingToHandle(state({ feed: [entry(2, false)] }))).toBe(true);
		expect(nothingToHandle(state({ feed: [entry(2, true)] }))).toBe(false);
		expect(nothingToHandle(state({ toTriage: [ticket] }))).toBe(false);
		expect(nothingToHandle(state({ conflicts: [{ ...ticket, kind: "conflict" }] }))).toBe(false);
		expect(nothingToHandle(state({ status: "loading" }))).toBe(false);
	});
});
