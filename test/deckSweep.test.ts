import { describe, expect, it } from "vitest";
import { press, startSession, ticketItems, type DeckState } from "../src/deck/deckSession";
import { chooseMove, sweepItems } from "../src/deck/sweepSession";
import type { SweepCandidate } from "../src/deck/sweep";
import type { InboxTicket } from "../src/remote/api";
import type { VaultProject } from "../src/inbox/inboxStore";

const widget: VaultProject = { id: "p1abc", path: "2.projects/Widget.md", title: "Widget", private: false };
const KEEP_UNTIL = "2026-11-04";

let n = 0;
const candidate = (patch: Partial<SweepCandidate> = {}): SweepCandidate => {
	const id = `s${String(n++).padStart(4, "0")}`;
	return {
		id,
		path: "1.meetings/2026-10-01.md",
		line: n,
		raw: `#bug p3 Export vide ^${id}`,
		title: "Export vide",
		type: "bug",
		priority: 3,
		description: "",
		day: "2026-10-01",
		...patch,
	};
};
const ticket: InboxTicket = {
	id: "t0001",
	type: "bug",
	title: "Heatmap vide",
	description: "",
	created_at: "2026-10-20T10:00:00.000Z",
	author_email: "jmj@edf.fr",
	urgency: "genant",
	requested_priority: null,
	project_id: null,
	zone_id: null,
};

const session = (swept: SweepCandidate[], tickets: InboxTicket[] = [ticket]): DeckState =>
	startSession([...sweepItems(swept, KEEP_UNTIL), ...ticketItems(tickets)], { projects: [widget], zones: [] });

const keys = (s: DeckState, ...names: string[]) => {
	let step = { state: s, effects: [] as ReturnType<typeof press>["effects"] };
	for (const key of names) step = press(step.state, key);
	return step;
};

describe("Deck keys on a Sweep item", () => {
	it("records the Frigo with z, then goes on, nothing written", () => {
		const [a, b] = [candidate(), candidate()];
		const { state, effects } = keys(session([a, b]), "z");
		expect(effects).toEqual([]);
		expect(state).toMatchObject({ index: 1, decisions: [{ kind: "frigo" }, null, null] });
	});

	it("records a keep with Enter until today plus the sweep age", () => {
		const { state, effects } = keys(session([candidate()]), "Enter");
		expect(effects).toEqual([]);
		expect(state.decisions[0]).toEqual({ kind: "keep", until: KEEP_UNTIL });
	});

	it("records a move into the Project picked with m; Escape on the picker leaves it", () => {
		const a = candidate();
		const picking = keys(session([a]), "m");
		expect(picking.effects).toEqual([{ kind: "pickMove", task: a }]);

		expect(chooseMove(picking.state, null)).toBe(picking.state);
		const moved = chooseMove(picking.state, { path: widget.path, id: widget.id });
		expect(moved).toMatchObject({ index: 1, decisions: [{ kind: "move", project: { path: widget.path, id: widget.id } }, null] });
	});

	it("goes back to a Sweep item with u, shows its decision and replaces it by deciding again", () => {
		const s = keys(session([candidate(), candidate()]), "z", "Enter", "u").state;
		expect(s.index).toBe(1);
		expect(s.decisions.slice(0, 2)).toEqual([{ kind: "frigo" }, { kind: "keep", until: KEEP_UNTIL }]);
		const back = keys(s, "u", "Enter").state;
		// Every line decided: the list's « Continuer » row.
		expect(back.index).toBe(2);
		expect(back.decisions.slice(0, 2)).toEqual([{ kind: "keep", until: KEEP_UNTIL }, { kind: "keep", until: KEEP_UNTIL }]);
		// From the first Ticket back into the Sweep.
		expect(keys(session([candidate()]), "z", "u").state.index).toBe(0);
	});

	it("on a line not Pushed yet, Enter only says keeping needs a Pushed line; z and m work", () => {
		const a = candidate({ id: null, raw: "#bug p3 Export vide" });
		const s = session([a]);
		const enter = keys(s, "Enter");
		expect(enter.effects).toEqual([]);
		expect(enter.state).toMatchObject({ index: 0, decisions: [null, null], message: { kind: "info", text: "Garder demande une ligne poussée : « Export vide » n'est pas encore dans l'app (z ou m la traitent)." } });
		expect(keys(s, "z").state.decisions[0]).toEqual({ kind: "frigo" });
		expect(keys(s, "m").effects).toEqual([{ kind: "pickMove", task: a }]);
	});

	it("knows only the Sweep list's keys: Ticket keys change nothing", () => {
		const s = session([candidate()]);
		for (const key of ["h", "b", "3", "q", "p", "o", "x", ".", "s"]) expect(keys(s, key)).toEqual({ state: s, effects: [] });
	});

	it("leaves z and m on a Ticket as they were (z: pz, m nothing), Z nothing at all", () => {
		const s = session([]);
		expect(keys(s, "Z")).toEqual({ state: s, effects: [] });
		expect(keys(s, "m")).toEqual({ state: s, effects: [] });
		expect(keys(s, "z").state.choices[ticket.id]).toMatchObject({ priority: "pz" });
	});

	it("puts the Sweep's decisions first among the cards written at the end", () => {
		const a = candidate();
		const s = keys(session([a]), "z", "Enter", "s").state;
		expect(keys(s, "Enter").effects).toEqual([
			{
				kind: "commit",
				cards: [
					{ index: 0, item: { kind: "sweep", task: a, keepUntil: KEEP_UNTIL }, decision: { kind: "frigo" } },
					{ index: 1, item: { kind: "ticket", ticket }, decision: { kind: "skip" } },
				],
			},
		]);
	});
});
