import { describe, expect, it, vi } from "vitest";
import { ItemView } from "obsidian";
import { feedLines, frigoLabel, nothingToHandle, InboxView, pinnedSections, triageButton } from "../src/views/InboxView";
import { conflictButtons } from "../src/views/inboxPinned";
import type { Conflict } from "../src/sync/compareState";
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
	unplaced: [],
	unplacedBulk: [],
	conflicts: [],
	feed: [],
	item: null,
	unread: 0,
	more: false,
	frigo: null,
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
		expect(nothingToHandle(state({ unplaced: [{ ...ticket, kind: "unplaced" }] }))).toBe(false);
		expect(nothingToHandle(state({ unplacedBulk: [{ kind: "project", id: "p0002", fields: { title: "W", description: "", priority: 1, done: false } }] }))).toBe(false);
		expect(nothingToHandle(state({ conflicts: [{ ...ticket, kind: "conflict" }] }))).toBe(false);
		expect(nothingToHandle(state({ status: "loading" }))).toBe(false);
	});

	it("labels a conflict's buttons with the value first and who chose it", () => {
		const c = { mine: { label: "P0" }, theirs: { label: "P1", by: "jmj" } } as Conflict;
		expect(conflictButtons(c).map((b) => b.text)).toEqual(["P0 (moi)", "P1 (jmj)"]);
		expect(conflictButtons({ ...c, theirs: { ...c.theirs, by: null } }).map((b) => b.text)).toEqual(["P0 (moi)", "P1 (Client)"]);
	});
});

describe("Inbox header Frigo count", () => {
	it("reads « Frigo (n) » once a Pull gave the count, nothing before", () => {
		expect(frigoLabel(state({ frigo: 12 }))).toBe("Frigo (12)");
		expect(frigoLabel(state({ frigo: 0 }))).toBe("Frigo (0)");
		expect(frigoLabel(state({}))).toBeNull();
	});
});

describe("Inbox « Trier (n) »", () => {
	it("replaces À trier with one button counting the Tickets", () => {
		expect(triageButton(state({ toTriage: [ticket, { ...ticket, key: "t10" }] }))).toBe("Trier (2)");
	});

	it("reads « Trier » without a count when no Ticket waits, so the Sweep keeps an entry", () => {
		expect(triageButton(state({}))).toBe("Trier");
	});

	it("keeps the Unplaced items and the conflicts pinned, the Tickets no longer listed", () => {
		const unplaced = { ...ticket, key: "u1", kind: "unplaced" as const };
		const conflict = { ...ticket, key: "c1", kind: "conflict" as const };
		const sections = pinnedSections(state({ toTriage: [ticket], unplaced: [unplaced], conflicts: [conflict] }));
		expect(sections.map((s) => [s.id, s.title, s.entries])).toEqual([
			["unplaced", "Hors du vault (1)", [unplaced]],
			["conflicts", "Conflits (1)", [conflict]],
		]);
		expect(pinnedSections(state({ toTriage: [ticket] }))).toEqual([]);
	});
});
