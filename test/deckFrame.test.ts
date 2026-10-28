import { describe, expect, it } from "vitest";
import { messageLine } from "../src/views/deckRender";
import { progressStrip } from "../src/views/deckStripRender";
import { endScreen } from "../src/views/deckListRender";
import { goTo, press, recordArchive, startSession, ticketItems, type DeckState } from "../src/deck/deckSession";
import { cardDone, commitDone } from "../src/deck/deckEnd";
import { chooseMove, sweepItems } from "../src/deck/sweepSession";
import type { SweepCandidate } from "../src/deck/sweep";
import type { InboxTicket, Zone } from "../src/remote/api";
import type { VaultProject } from "../src/inbox/inboxStore";
import { typeColorsCss } from "../src/views/kanban/boards";

const widget: VaultProject = { id: "p1abc", path: "2.projects/Widget.md", title: "Widget", private: false };
const zones: Zone[] = [{ id: 1, name: "Heatmap", path: "/carte" }];
const context = { projects: [widget], zones };
const ticket = (id: string, title: string, patch: Partial<InboxTicket> = {}): InboxTicket => ({
	id,
	type: "bug",
	title,
	description: "",
	created_at: `2026-10-20T10:00:0${id.slice(1)}.000Z`,
	author_email: "jmj@edf.fr",
	urgency: "bloquant",
	requested_priority: null,
	project_id: null,
	zone_id: null,
	...patch,
});
const swept = (id: string): SweepCandidate => ({
	id,
	path: "1.meetings/2026-10-01.md",
	line: 1,
	raw: `#bug p3 Ligne ${id} ^${id}`,
	title: `Ligne ${id}`,
	type: "bug",
	priority: 3,
	description: "",
	day: "2026-10-01",
});

/** Sweep s1, s2, s3; Tickets t1 (Bloquant: p0), t2 (Pour plus tard: the Frigo), t3, t4, t5. */
const fresh = () =>
	startSession(
		[
			...sweepItems([swept("s1"), swept("s2"), swept("s3")], "2026-11-04"),
			...ticketItems([
				ticket("t1", "Heatmap vide"),
				ticket("t2", "Carte des flux", { urgency: "plus_tard" }),
				ticket("t3", "Doublon"),
				ticket("t4", "Question unités"),
				ticket("t5", "Bouton déborde"),
			]),
		],
		context,
	);
/** The Sweep's lines all to the Frigo, on the first Ticket. */
const sweptAll = () => ["z", "z", "z", "Enter"].reduce((s, key) => press(s, key).state, fresh());
/** Every kind of decision: s1 au frigo, s2 moved, s3 kept; t1 written p0, t2 written to the Frigo, t3 archived, t4 skipped; t5 current. */
const decided = (): DeckState => {
	let s = fresh();
	s = chooseMove(press(press(s, "z").state, "m").state, { path: widget.path, id: widget.id });
	// s3 kept, « Continuer », t1 and t2 written.
	s = press(press(press(press(s, "Enter").state, "Enter").state, "Enter").state, "Enter").state;
	s = recordArchive(press(s, "x").state, null);
	return press(s, "s").state;
};

describe("Deck frame: the progress strip", () => {
	it("has a dot per card, Sweep then Tickets then the end, each marked by its recorded decision, the current one ringed", () => {
		const strip = progressStrip(decided())!;
		expect(strip.groups.map((g) => g.kind)).toEqual(["sweep", "ticket", "end"]);
		expect(strip.groups.flatMap((g) => g.dots).map((d) => [d.title, d.mark, d.priority, d.current])).toEqual([
			["Ligne s1", "frigo", null, false],
			["Ligne s2", "moved", null, false],
			["Ligne s3", "kept", null, false],
			["Heatmap vide", "written", "p0", false],
			["Carte des flux", "frigo", null, false],
			["Doublon", "archived", null, false],
			["Question unités", "skipped", null, false],
			["Bouton déborde", "none", null, true],
			["Fin", "none", null, false],
		]);
	});

	it("says where the session is and counts its decisions", () => {
		const s = fresh();
		expect(progressStrip(s)).toMatchObject({ position: "Balayage 1 / 3", tally: "" });
		expect(progressStrip(press(s, "z").state)).toMatchObject({ position: "Balayage 2 / 3", tally: "1 au frigo" });
		expect(progressStrip(decided())).toMatchObject({
			position: "Ticket 5 / 5",
			tally: "1 écrite · 2 au frigo · 1 archivée · 1 passée · 1 gardée · 1 déplacée",
		});
		const end = press(decided(), "Enter").state;
		expect(progressStrip(end)).toMatchObject({ position: "Fin", tally: "2 écrites · 2 au frigo · 1 archivée · 1 passée · 1 gardée · 1 déplacée" });
		expect(progressStrip(end)!.groups[2]!.dots[0]!.current).toBe(true);
	});

	it("shows no strip when there is nothing to triage", () => {
		expect(progressStrip(startSession([], context))).toBeNull();
	});
});

describe("Deck frame: going to a card of the strip", () => {
	it("moves to a card already reached, back or forward, and does nothing on one not reached", () => {
		const s = decided();
		expect(progressStrip(s)!.groups.flatMap((g) => g.dots).map((d) => d.reached)).toEqual([true, true, true, true, true, true, true, true, false]);
		const there = goTo(s, 1);
		expect(there).toMatchObject({ index: 1, field: "type" });
		expect(goTo(there, 7).index).toBe(7);
		expect(goTo(there, 8)).toBe(there);
		expect(goTo(fresh(), 4)).toEqual(fresh());
	});

	it("drops a change not recorded on the card it leaves, as going back does", () => {
		const s = goTo(decided(), 3);
		const changed = press(s, "4").state;
		const left = goTo(changed, 6);
		expect(left.choices["t1"]!.priority).toBe(0);
	});

	it("goes nowhere once the session writes", () => {
		const writing = press(press(decided(), "Enter").state, "Enter").state;
		expect(goTo(writing, 0)).toBe(writing);
	});
});

describe("Deck frame: the message line", () => {
	it("informs in blue with ⓘ, and shows a failure in red", () => {
		expect(messageLine({ kind: "info", text: "comme le précédent" })).toEqual({ text: "ⓘ comme le précédent", cls: "suivi-deck-message is-info" });
		expect(messageLine({ kind: "error", text: "Tickets indisponibles : 502" })).toEqual({ text: "Tickets indisponibles : 502", cls: "suivi-deck-message is-error" });
		expect(messageLine(null)).toBeNull();
	});

	it("tells a line not pushed can't be kept as information", () => {
		const s = startSession(sweepItems([{ ...swept("s1"), id: null }], "2026-11-04"), context);
		expect(press(s, "Enter").state.message).toMatchObject({ kind: "info" });
	});

	it("says « comme le précédent » briefly when `.` copies the previous card's choices, nothing when there is none", () => {
		const s = press(sweptAll(), "Enter").state;
		expect(press(s, ".").state.message).toEqual({ kind: "info", text: "comme le précédent", brief: true });
		expect(press(sweptAll(), ".").state.message).toBeNull();
	});

	it("gives a stale Ticket's result as information and a failure as one", () => {
		let writing = press(decided(), "Enter").state;
		writing = press(writing, "Enter").state;
		writing = cardDone(writing, 3, { kind: "written" });
		writing = cardDone(writing, 4, { kind: "stale" });
		writing = cardDone(writing, 5, { kind: "failed", error: "Suivi unreachable" });
		const rows = endScreen(commitDone(writing, null)).tickets;
		expect(rows.slice(0, 4).map((r) => r.status?.tone ?? null)).toEqual(["done", "info", "error", null]);
	});
});

describe("Deck frame: type colours", () => {
	it("are the kanban's, as `--type-color` on the Deck's elements carrying a type", () => {
		const css = typeColorsCss([".suivi-deck "]);
		expect(css).toContain('.suivi-deck [data-type="bug"] {\n\t--type-color: #b82626;\n}');
		expect(css).toContain('.suivi-deck [data-type="idea"] {\n\t--type-color: #0f6e66;\n}');
		expect(css).not.toContain('"task"');
	});
});
