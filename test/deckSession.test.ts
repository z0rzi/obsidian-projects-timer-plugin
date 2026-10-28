import { describe, expect, it } from "vitest";
import {
	DECK_KEYS,
	decisionCount,
	press,
	recordArchive,
	startSession,
	ticketItems,
	type DeckEffect,
	type DeckState,
} from "../src/deck/deckSession";
import { cardDone, commitDone } from "../src/deck/deckEnd";
import { choose } from "../src/deck/ticketSession";
import type { InboxTicket, Zone } from "../src/remote/api";
import type { VaultProject } from "../src/inbox/inboxStore";

const widget: VaultProject = { id: "p1abc", path: "2.projects/Widget.md", title: "Widget", private: false };
const turpe: VaultProject = { id: "p2def", path: "2.projects/Turpe.md", title: "Turpe", private: false };
const zones: Zone[] = [
	{ id: 1, name: "Heatmap", path: "/carte" },
	{ id: 2, name: "Export", path: "" },
];

let n = 0;
const ticket = (patch: Partial<InboxTicket> = {}): InboxTicket => ({
	id: `t${String(n++).padStart(4, "0")}`,
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

const session = (...tickets: InboxTicket[]): DeckState =>
	startSession(
		tickets.map((t) => ({ kind: "ticket", ticket: t })),
		{ projects: [widget, turpe], zones },
	);

/** The choice the session holds for its current item. */
const current = (s: DeckState) => s.choices[s.items[s.index]!.ticket.id]!;

describe("Deck defaults from the Client's hints", () => {
	it("proposes Bloquant at p0 whatever the type, a Gênant bug the Frigo, a Gênant Retouche Rapide, a Gênant task the Client's Priority", () => {
		const cases: [Partial<InboxTicket>, string, unknown][] = [
			[{ type: "bug", urgency: "bloquant" }, "bug", 0],
			[{ type: "task", urgency: "bloquant", requested_priority: 4 }, "task", 0],
			[{ type: "bug", urgency: "genant" }, "bug", "pz"],
			[{ type: "quick", urgency: "genant" }, "quick", "pq"],
			[{ type: "task", urgency: "genant", requested_priority: 4 }, "task", 4],
			[{ type: "task", urgency: "genant", requested_priority: 1 }, "task", 1],
			// Sent before the Client chose a Priority.
			[{ type: "task", urgency: "genant", requested_priority: null }, "task", 2],
		];
		for (const [hints, type, priority] of cases) {
			expect(current(session(ticket(hints)))).toMatchObject({ type, priority });
		}
	});

	it("sends Pour plus tard and a Nouveau chantier to the Frigo, and proposes p3 without an Urgency", () => {
		expect(current(session(ticket({ type: "bug", urgency: "plus_tard" })))).toMatchObject({ type: "bug", priority: "pz" });
		expect(current(session(ticket({ type: "quick", urgency: "plus_tard" })))).toMatchObject({ type: "quick", priority: "pz" });
		expect(current(session(ticket({ type: "idea", urgency: null })))).toMatchObject({ type: "idea", priority: "pz" });
		expect(current(session(ticket({ type: "bug", urgency: null })))).toMatchObject({ type: "bug", priority: 3 });
		expect(current(session(ticket({ type: "task", urgency: null })))).toMatchObject({ type: "task", priority: 3 });
	});

	it("keeps a Retouche never ranked: without an Urgency it is a Rapide, Bloquant makes it a p0 task", () => {
		expect(current(session(ticket({ type: "quick", urgency: null })))).toMatchObject({ type: "quick", priority: "pq" });
		expect(current(session(ticket({ type: "quick", urgency: "bloquant" })))).toMatchObject({ type: "task", priority: 0 });
	});

	it("takes the Project and the Zone from the hints, none when the vault or the app has no such one", () => {
		expect(current(session(ticket({ project_id: "p2def", zone_id: 2 })))).toMatchObject({
			project: { path: "2.projects/Turpe.md", id: "p2def" },
			zone: 2,
		});
		expect(current(session(ticket({ project_id: "p9out", zone_id: 7 })))).toMatchObject({ project: null, zone: null });
		expect(current(session(ticket()))).toMatchObject({ project: null, zone: null });
	});

	it("starts on the first Ticket, on the type field, with nothing written yet", () => {
		const first = ticket();
		const s = session(first, ticket());
		expect(s.items[s.index]!.ticket).toBe(first);
		expect(s.field).toBe("type");
		expect(s.decisions).toEqual([null, null]);
		expect(s.phase).toBe("deciding");
	});
});

/** The state after pressing `keys` in turn, and the effects of the last one. */
function keys(s: DeckState, ...names: string[]): { state: DeckState; effects: DeckEffect[] } {
	let out = { state: s, effects: [] as DeckEffect[] };
	for (const name of names) out = press(out.state, name);
	return out;
}
const after = (s: DeckState, ...names: string[]) => keys(s, ...names).state;

describe("Deck keys", () => {
	it("moves between the fields with j and k, stopping at the ends", () => {
		const s = session(ticket());
		expect(after(s, "j").field).toBe("priority");
		expect(after(s, "j", "j", "j").field).toBe("zone");
		expect(after(s, "j", "j", "j", "j").field).toBe("zone");
		expect(after(s, "j", "k").field).toBe("type");
		expect(after(s, "k").field).toBe("type");
	});

	it("goes through the types with h and l on the type field: task, bug, quick, wait, idea", () => {
		const s = session(ticket({ type: "bug", urgency: "plus_tard" }));
		expect(current(after(s, "l")).type).toBe("quick");
		expect(current(after(s, "l", "l", "l")).type).toBe("idea");
		expect(current(after(s, "l", "l", "l", "l")).type).toBe("idea");
		expect(current(after(s, "h")).type).toBe("task");
		expect(current(after(s, "h", "h")).type).toBe("task");
	});

	it("goes through p0 to p5, Rapide and pz with h and l on the Priority field", () => {
		const s = after(session(ticket({ type: "task", urgency: "genant" })), "j");
		expect(current(after(s, "l")).priority).toBe(3);
		expect(current(after(s, "h", "h")).priority).toBe(0);
		expect(current(after(s, "h", "h", "h")).priority).toBe(0);
		expect(current(after(s, "l", "l", "l", "l")).priority).toBe("pq");
		expect(current(after(s, "l", "l", "l", "l", "l", "l")).priority).toBe("pz");
	});

	it("goes through the Project and Zone picked, the Client's and none with h and l, stopping at the ends", () => {
		const picked = choose(choose(session(ticket({ project_id: "p1abc", zone_id: 1 })), "project", { path: turpe.path, id: turpe.id }), "zone", 2);
		const s = { ...picked, field: "type" as const };
		const project = after(s, "j", "j");
		expect(current(after(project, "l")).project).toEqual({ path: widget.path, id: widget.id });
		expect(current(after(project, "l", "l", "l")).project).toBeNull();
		expect(current(after(project, "l", "l", "h")).project).toEqual({ path: widget.path, id: widget.id });
		expect(current(after(project, "h")).project).toEqual({ path: turpe.path, id: turpe.id });
		const zone = after(s, "j", "j", "j");
		expect(current(after(zone, "l")).zone).toBe(1);
		expect(current(after(zone, "l", "l", "l")).zone).toBeNull();
		expect(current(after(zone, "l", "l", "h")).zone).toBe(1);
	});

	it("sets the type with b, q, t, w and i, and the Priority with 0 to 5 and z, from any field", () => {
		const s = after(session(ticket({ type: "task", urgency: "genant" })), "j", "j", "j");
		expect(current(after(s, "b"))).toMatchObject({ type: "bug", priority: 2 });
		expect(current(after(s, "w"))).toMatchObject({ type: "wait", priority: 2 });
		expect(current(after(s, "i"))).toMatchObject({ type: "idea", priority: 2 });
		expect(current(after(s, "b", "t"))).toMatchObject({ type: "task", priority: 2 });
		expect(current(after(s, "4"))).toMatchObject({ type: "task", priority: 4 });
		expect(current(after(s, "0"))).toMatchObject({ type: "task", priority: 0 });
		expect(current(after(s, "z"))).toMatchObject({ type: "task", priority: "pz" });
		expect(after(s, "b", "4").field).toBe("zone");
	});

	it("keeps the Rapide rule: q is a Rapide, a rank makes a Retouche a task, another type drops Rapide", () => {
		const bug = session(ticket({ type: "bug", urgency: "genant" }));
		expect(current(after(bug, "q"))).toMatchObject({ type: "quick", priority: "pq" });
		expect(current(after(bug, "z", "q"))).toMatchObject({ type: "quick", priority: "pq" });
		expect(current(after(bug, "q", "3"))).toMatchObject({ type: "task", priority: 3 });
		expect(current(after(bug, "q", "z"))).toMatchObject({ type: "quick", priority: "pz" });
		// Another type: the default Priority of that type for a Gênant Ticket.
		expect(current(after(bug, "q", "b"))).toMatchObject({ type: "bug", priority: "pz" });
		expect(current(after(bug, "q", "t"))).toMatchObject({ type: "task", priority: 2 });
		const asked = session(ticket({ type: "task", urgency: "genant", requested_priority: 4 }));
		expect(current(after(asked, "q", "t"))).toMatchObject({ type: "task", priority: 4 });
		// h/l onto quick: a rank becomes Rapide, pz stays.
		const task = session(ticket({ type: "task", urgency: "genant" }));
		expect(current(after(task, "l", "l"))).toMatchObject({ type: "quick", priority: "pq" });
		expect(current(after(task, "z", "l", "l"))).toMatchObject({ type: "quick", priority: "pz" });
		// h/l onto Rapide makes it a quick; off it onto a rank, a task.
		expect(current(after(task, "j", "5", "l"))).toMatchObject({ type: "quick", priority: "pq" });
		expect(current(after(task, "j", "5", "l", "h"))).toMatchObject({ type: "task", priority: 5 });
	});

	it("leaves the Zone to the app when the Zones could not be loaded: no Zone in the line, h, l and o change nothing", () => {
		const t = ticket({ zone_id: 1 });
		const s = startSession([{ kind: "ticket", ticket: t }], { projects: [widget], zones: null });
		expect(current(s)).not.toHaveProperty("zone");
		const onZone = after(s, "j", "j", "j");
		expect(current(after(onZone, "l"))).not.toHaveProperty("zone");
		expect(current(after(onZone, "h"))).not.toHaveProperty("zone");
		expect(keys(onZone, "o").effects).toEqual([]);
		const write = after(onZone, "Enter").decisions[0] as { kind: "write"; choice: object };
		expect(write.choice).not.toHaveProperty("zone");
	});

	it("opens the Project picker with p and the Zone picker with o; a pick sets the field, none clears the Project", () => {
		const t = ticket({ project_id: "p1abc", zone_id: 1 });
		const s = session(t);
		expect(keys(s, "p").effects).toEqual([{ kind: "pick", field: "project", ticket: t }]);
		expect(keys(s, "o").effects).toEqual([{ kind: "pick", field: "zone", ticket: t }]);
		expect(keys(s, "p").state.field).toBe("project");
		expect(keys(s, "o").state.field).toBe("zone");
		expect(current(choose(s, "project", { path: turpe.path, id: turpe.id })).project).toEqual({ path: turpe.path, id: turpe.id });
		expect(current(choose(s, "project", null)).project).toBeNull();
		expect(current(choose(s, "zone", 2)).zone).toBe(2);
		expect(current(choose(s, "zone", null)).zone).toBeNull();
	});

	it("records the current choice with Enter and goes to the next Ticket, nothing written", () => {
		const first = ticket({ type: "bug", urgency: "genant", project_id: "p1abc", zone_id: 2 });
		const second = ticket({ title: "Export lent" });
		const { state, effects } = keys(session(first, second), "j", "j", "Enter");
		const choice = { type: "bug", priority: "pz", project: { path: widget.path, id: widget.id }, zone: 2 };
		expect(effects).toEqual([]);
		expect(state).toMatchObject({ index: 1, field: "type", message: null });
		expect(state.decisions).toEqual([{ kind: "write", choice }, null]);
	});

	it("repeats the previous Ticket's choices with ., to record with Enter", () => {
		const s = session(ticket({ type: "bug", urgency: "genant", project_id: "p1abc" }), ticket({ type: "task", urgency: "plus_tard" }));
		expect(after(s, ".")).toEqual(s);
		const repeated = after(s, "q", "j", "j", "Enter", ".");
		expect(current(repeated)).toEqual({ type: "quick", priority: "pq", project: { path: widget.path, id: widget.id }, zone: null });
		expect(after(repeated, "Enter").decisions[1]).toEqual({ kind: "write", choice: current(repeated) });
	});

	it("skips a Ticket with s, then shows the end screen after the last one, where only Enter writes", () => {
		const [a, b] = [ticket(), ticket()];
		const s = session(a, b);
		const one = keys(s, "s");
		expect(one.effects).toEqual([]);
		expect(one.state).toMatchObject({ index: 1, field: "type", decisions: [{ kind: "skip" }, null] });
		const end = keys(one.state, "j", "Enter");
		expect(end.state.index).toBe(2);
		expect(end.effects).toEqual([]);
		for (const key of ["s", "x", "z", ".", "j"]) expect(keys(end.state, key)).toEqual({ state: end.state, effects: [] });
		const commit = keys(end.state, "Enter");
		expect(commit.state.phase).toBe("committing");
		expect(commit.effects).toEqual([
			{
				kind: "commit",
				cards: [
					{ index: 0, item: { kind: "ticket", ticket: a }, decision: { kind: "skip" } },
					{ index: 1, item: { kind: "ticket", ticket: b }, decision: { kind: "write", choice: current(s) } },
				],
			},
		]);
		// Keys wait for the writes.
		expect(keys(commit.state, "u")).toEqual({ state: commit.state, effects: [] });
	});

	it("asks the archive's comment with x, and records it with the comment given; Escape on it leaves the Ticket", () => {
		const t = ticket();
		const { state, effects } = keys(session(t, ticket()), "x");
		expect(effects).toEqual([{ kind: "archive", ticket: t, comment: null }]);
		expect(state.index).toBe(0);
		const archived = recordArchive(state, "Doublon");
		expect(archived).toMatchObject({ index: 1, decisions: [{ kind: "archive", comment: "Doublon" }, null] });
	});

	it("goes back with u card by card to the first, the recorded choices shown and changed by deciding again", () => {
		const [a, b] = [ticket({ type: "bug", urgency: "genant" }), ticket()];
		const end = after(session(a, b), "3", "Enter", "x");
		const done = recordArchive(end, "Doublon");
		expect(done.index).toBe(2);

		const onB = after(done, "u");
		expect(onB).toMatchObject({ index: 1, field: "type" });
		expect(keys(onB, "x").effects).toEqual([{ kind: "archive", ticket: b, comment: "Doublon" }]);
		const onA = after(onB, "u");
		expect(onA.index).toBe(0);
		expect(current(onA)).toMatchObject({ type: "bug", priority: 3 });
		expect(after(onA, "u")).toEqual(onA);

		const changed = after(onA, "q", "s");
		expect(changed.decisions).toEqual([{ kind: "skip" }, { kind: "archive", comment: "Doublon" }]);
		expect(changed.index).toBe(1);
	});

	it("leaves a recorded line as recorded when its card is left with u, unchanged", () => {
		const s = after(session(ticket(), ticket({ type: "bug", urgency: "genant" })), "Enter", "3", "Enter", "u", "5", "u");
		expect(s.index).toBe(0);
		expect(s.choices[s.items[1]!.ticket.id]).toMatchObject({ priority: 3 });
		expect(s.decisions[1]).toEqual({ kind: "write", choice: s.choices[s.items[1]!.ticket.id] });
	});

	it("counts the decisions recorded, before discarding them", () => {
		const s = recordArchive(after(session(ticket(), ticket(), ticket(), ticket()), "Enter", "s", "x"), null);
		expect(decisionCount(s)).toBe(3);
	});

	it("takes each card's result as it is written, then the closing Push's: the report", () => {
		const [a, b, c] = [ticket({ title: "Heatmap vide" }), ticket(), ticket()];
		const committing = after(session(a, b, c), "Enter", "Enter", "s", "Enter");
		let s = cardDone(committing, 0, { kind: "stale" });
		s = cardDone(s, 1, { kind: "failed", error: "Suivi unreachable" });
		s = cardDone(s, 2, { kind: "skipped" });
		expect(s.results).toEqual([{ kind: "stale" }, { kind: "failed", error: "Suivi unreachable" }, { kind: "skipped" }]);
		const end = commitDone(s, null);
		expect(end).toMatchObject({ phase: "done", pushed: null });
		expect(keys(end, "u")).toEqual({ state: end, effects: [] });
	});

	it("ignores keys it does not know", () => {
		const s = session(ticket());
		expect(keys(s, "a")).toEqual({ state: s, effects: [] });
		expect(keys(s, "J")).toEqual({ state: s, effects: [] });
	});

	it("has a key for every choice of the spec", () => {
		expect(DECK_KEYS).toEqual(["j", "k", "h", "l", "b", "q", "t", "w", "i", "0", "1", "2", "3", "4", "5", "z", "p", "o", "x", "Enter", ".", "s", "u", "m"]);
	});
});

describe("Deck order", () => {
	it("takes the Tickets oldest first, after the items the caller puts before them", () => {
		const late = ticket({ created_at: "2026-10-22T09:00:00.000Z" });
		const early = ticket({ created_at: "2026-10-19T09:00:00.000Z" });
		const sameA = ticket({ id: "taaaa", created_at: "2026-10-21T09:00:00.000Z" });
		const sameB = ticket({ id: "tbbbb", created_at: "2026-10-21T09:00:00.000Z" });
		expect(ticketItems([late, sameB, early, sameA]).map((i) => i.ticket)).toEqual([early, sameA, sameB, late]);
		const s = startSession([...ticketItems([late]), ...ticketItems([early])], { projects: [], zones: [] });
		expect(s.items.map((i) => i.ticket)).toEqual([late, early]);
	});
});
