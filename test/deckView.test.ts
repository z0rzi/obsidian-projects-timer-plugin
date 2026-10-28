import { describe, expect, it, vi } from "vitest";
import { ItemView } from "obsidian";
import { DeckView } from "../src/views/DeckView";
import { decisionText, deckKey } from "../src/views/deckRender";
import { DeckPicker } from "../src/ui/DeckPicker";
import { tickUnlessUnloaded } from "../src/ui/nextTick";
import { press, recordArchive, startSession, ticketItems, type DeckState } from "../src/deck/deckSession";
import { chooseMove } from "../src/deck/sweepSession";
import { sweepItems } from "../src/deck/sweepSession";
import type { SweepCandidate } from "../src/deck/sweep";
import type { InboxTicket, Zone } from "../src/remote/api";
import type { VaultProject } from "../src/inbox/inboxStore";

const widget: VaultProject = { id: "p1abc", path: "2.projects/Widget.md", title: "Widget", private: false };
const zones: Zone[] = [{ id: 1, name: "Heatmap", path: "/carte" }];
const ticket = (patch: Partial<InboxTicket> = {}): InboxTicket => ({
	id: "t7f3a",
	type: "bug",
	title: "Heatmap vide",
	description: "Rien ne s'affiche",
	created_at: "2026-10-20T10:00:00.000Z",
	author_email: "jmj@edf.fr",
	urgency: "genant",
	requested_priority: null,
	project_id: null,
	zone_id: null,
	...patch,
});
const context = { projects: [widget], zones };
const session = (t: InboxTicket): DeckState => startSession(ticketItems([t]), context);

describe("Deck view: keys", () => {
	it("forwards a key pressed alone or with Shift, never one with Ctrl, Cmd or Alt (Obsidian's shortcuts)", () => {
		const k = (key: string, more: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
			deckKey({ key, ctrlKey: false, metaKey: false, altKey: false, ...more });
		expect(k("j")).toBe("j");
		expect(k("Enter")).toBe("Enter");
		expect(k(".")).toBe(".");
		expect(k("p", { ctrlKey: true })).toBeNull();
		expect(k("p", { metaKey: true })).toBeNull();
		expect(k("x", { altKey: true })).toBeNull();
	});

	it("keeps Obsidian's View.open", () => {
		const view = new DeckView({} as never, {} as never);
		expect(Object.prototype.hasOwnProperty.call(view, "open")).toBe(false);
		expect(view.open).toBe(ItemView.prototype.open);
	});
});

describe("Deck pickers", () => {
	it("hands over the item chosen, as Obsidian calls it: after closing", () => {
		const pick = vi.fn();
		const cancel = vi.fn();
		const ticks: (() => void)[] = [];
		const picker = new DeckPicker({} as never, [widget], (p) => p.title, "Projet…", pick, cancel, (run) => void ticks.push(run));
		expect(picker.getItems()).toEqual([widget]);
		expect(picker.getItemText(widget)).toBe("Widget");
		picker.open();
		picker.close();
		picker.onChooseItem(widget);
		for (const run of ticks) run();
		expect(pick).toHaveBeenCalledWith(widget);
		expect(cancel).not.toHaveBeenCalled();
	});

	it("tells of Escape: closed without a choice, once the close's tick, given by its owner, has passed", () => {
		const cancel = vi.fn();
		const ticks: (() => void)[] = [];
		const picker = new DeckPicker({} as never, [widget], (p) => p.title, "Projet…", () => {}, cancel, (run) => void ticks.push(run));
		picker.open();
		picker.close();
		expect(cancel).not.toHaveBeenCalled();
		for (const run of ticks) run();
		expect(cancel).toHaveBeenCalledOnce();
	});
});

describe("Deck pickers' tick", () => {
	/** A view as Obsidian's Component holds cleanups: `register` keeps them, `unload` runs them. */
	const owner = () => {
		const cleanups: (() => void)[] = [];
		return { cleanups, register: (cb: () => void) => void cleanups.push(cb), unload: () => cleanups.forEach((cb) => cb()) };
	};

	it("runs on the next tick, registering one cleanup however many picks", () => {
		vi.useFakeTimers();
		const view = owner();
		const nextTick = tickUnlessUnloaded(view);
		const ran = vi.fn();
		for (let i = 0; i < 5; i++) {
			nextTick(ran);
			vi.runAllTimers();
		}
		expect(ran).toHaveBeenCalledTimes(5);
		expect(view.cleanups).toHaveLength(1);
		vi.useRealTimers();
	});

	it("never runs a tick still pending when the view unloads", () => {
		vi.useFakeTimers();
		const view = owner();
		const ran = vi.fn();
		tickUnlessUnloaded(view)(ran);
		view.unload();
		vi.runAllTimers();
		expect(ran).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});

describe("Deck view: going back", () => {
	const swept = (id: string): SweepCandidate => ({
		id,
		path: "1.meetings/2026-10-01.md",
		line: 1,
		raw: `#bug p3 Export vide ^${id}`,
		title: `Ligne ${id}`,
		type: "bug",
		priority: 3,
		description: "",
		day: "2026-10-01",
	});
	const tickets = [ticket({ id: "t1", title: "Heatmap vide" }), ticket({ id: "t2", title: "Export lent" }), ticket({ id: "t3", title: "Doublon" })];
	/** Sweep: s1 to the Frigo, s2 moved, s3 kept; Tickets: t1 written, t2 archived, t3 skipped. */
	const decided = () => {
		let s = startSession([...sweepItems([swept("s1"), swept("s2"), swept("s3")], "2026-11-04"), ...ticketItems(tickets)], context);
		s = chooseMove(press(press(s, "z").state, "m").state, { path: widget.path, id: widget.id });
		// s3 kept, « Continuer », t1 written.
		s = press(press(press(s, "Enter").state, "Enter").state, "Enter").state;
		s = recordArchive(press(s, "x").state, "déjà fait");
		return press(s, "s").state;
	};
	const back = (s: DeckState, times: number) => Array.from({ length: times }).reduce<DeckState>((state) => press(state, "u").state, s);

	it("shows on a Ticket gone back to the decision it has; the Sweep's show on its list", () => {
		const s = decided();
		expect([1, 2, 3, 4].map((n) => decisionText(back(s, n)))).toEqual([
			"Décision : passer",
			"Décision : archiver (« déjà fait »)",
			"Décision : écrire",
			null,
		]);
		expect(decisionText(startSession(ticketItems(tickets), context))).toBeNull();
	});
});
