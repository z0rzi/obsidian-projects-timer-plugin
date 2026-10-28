import { describe, expect, it } from "vitest";
import { commitCards } from "../src/deck/deckCommit";
import { archiveTicket, writeTicket } from "../src/deck/deckRun";
import { press, recordArchive, startSession, ticketItems, type DeckEffect, type DeckState } from "../src/deck/deckSession";
import { cardDone, commitDone } from "../src/deck/deckEnd";
import { chooseMove, sweepItems } from "../src/deck/sweepSession";
import { frigoTasks, keepTask, moveTask } from "../src/deck/sweepRun";
import type { SweepCandidate } from "../src/deck/sweep";
import type { TriageDeps } from "../src/inbox/triage";
import type { InboxTicket } from "../src/remote/api";
import { appTask, fakeLinks, pushWorld } from "./fakeSuivi";

const today = "1.meetings/2026-10-28.md";
const daily = "1.meetings/2026-10-01.md";
const widget = "2.projects/Widget.md";

const ticket = (id: string, patch: Partial<InboxTicket> = {}): InboxTicket => ({
	id,
	type: "bug",
	title: `Ticket ${id}`,
	description: "",
	created_at: `2026-10-20T10:00:0${id.at(-1)}.000Z`,
	changed_at: "2026-10-20T10:00:00.000Z",
	author_email: "jmj@edf.fr",
	urgency: "bloquant",
	requested_priority: null,
	project_id: null,
	zone_id: null,
	...patch,
});

/** The app holding `tickets` À trier, a vault with an old Daily note of two pushed lines and a Project note. */
async function world(tickets: InboxTicket[]) {
	const w = pushWorld(
		{
			[widget]: "---\nsuivi_id: p0002\npriority: 2\n---\n# Widget\n\n## Tasks\n",
			[daily]: "## Triage\n#bug p3 Export vide ^s0001\n#task p4 Relancer JMJ ^s0002\n",
		},
		tickets.map((t) => appTask(t.id, { title: t.title, type: t.type, priority: null, description: "" }, { triaged: false })),
	);
	expect((await w.push()).failed).toEqual([]);
	const swept = (id: string): SweepCandidate => {
		const lines = w.files.get(daily)!.split("\n");
		const line = lines.findIndex((l) => l.endsWith(`^${id}`));
		return { id, path: daily, line, raw: lines[line]!, title: id, type: "bug", priority: 3, description: "", day: "2026-10-01" };
	};
	const triage: TriageDeps = {
		remote: w.app.remote,
		dailyNote: today,
		heading: "## Triage",
		template: async () => "",
		async write(path, edit) {
			const content = edit(w.files.get(path) ?? null);
			w.files.set(path, content);
			return content;
		},
		linkText: (path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
		projects: { links: fakeLinks(() => [...w.files.keys()]), isProject: (p) => p.startsWith("2.projects/") },
		appUrl: "https://suivi.test/",
	};
	const notices: string[] = [];
	const deps = {
		write: (t: InboxTicket, choice: Parameters<typeof writeTicket>[1]) => writeTicket(t, choice, triage),
		archive: (t: InboxTicket, comment: string | null) => archiveTicket(t, comment, w.app.remote),
		frigo: (tasks: SweepCandidate[]) => frigoTasks(tasks, w.vault),
		move: (task: SweepCandidate, project: { path: string; id: string }) => moveTask(task, project, w.vault),
		keep: (task: SweepCandidate, until: string) => keepTask(task, until, w.app.remote),
		notify: (message: string) => void notices.push(message),
	};
	return { ...w, swept, deps, notices };
}

/** The state after `keys` in turn. */
const after = (s: DeckState, ...keys: string[]) => keys.reduce((state, key) => press(state, key).state, s);

/** Enter on the end screen, every card written in turn, and the report (nothing pushed). */
async function commit(s: DeckState, deps: Parameters<typeof commitCards>[1]) {
	const step = press(s, "Enter");
	const effect = step.effects[0] as Extract<DeckEffect, { kind: "commit" }>;
	let state = step.state;
	await commitCards(effect.cards, deps, (index, result) => (state = cardDone(state, index, result)));
	return commitDone(state, null);
}

describe("The Deck writes at the end of the session", () => {
	it("writes nothing while deciding, then everything in the session's order, a failing card left undone and the others written", async () => {
		const tickets = [
			ticket("t1"),
			ticket("t2"),
			ticket("t3"),
			ticket("t4"),
			ticket("t5"),
		];
		const w = await world(tickets);
		const before = new Map(w.files);
		const s0 = startSession([...sweepItems([w.swept("s0001"), w.swept("s0002")], "2026-11-04"), ...ticketItems(tickets)], {
			projects: [{ id: "p0002", path: widget, title: "Widget", private: false }],
			zones: [],
		});

		// Sweep: s0001 to the Frigo, s0002 moved; Tickets: t1 written (p0, then back with u for p3), t2 edited by its
		// author meanwhile, t3 archived, t4 failing in the app, t5 skipped.
		let s = after(s0, "z", "m");
		s = chooseMove(s, { path: widget, id: "p0002" });
		// « Continuer » to the Tickets.
		s = after(s, "Enter", "Enter", "Enter", "u", "u", "3", "Enter", "Enter", "x");
		s = recordArchive(s, "Doublon");
		s = after(s, "Enter", "s");
		expect(s.index).toBe(s.items.length);
		w.app.editTicket("t2", { title: "Modifié" }, "2026-10-28T08:00:00.000Z");

		expect(w.app.triageRequests).toEqual([]);
		expect(w.app.archivedWith).toEqual([]);
		expect(w.app.deck.at).toBeNull();
		expect(w.files).toEqual(before);

		const end = await commit(s, {
			...w.deps,
			write: async (t, choice) => (t.id === "t4" ? { outcome: { kind: "failed", error: "Suivi unreachable" } } : w.deps.write(t, choice)),
		});

		expect(end.results).toEqual([
			{ kind: "frigo" },
			{ kind: "moved" },
			{ kind: "written" },
			{ kind: "stale" },
			{ kind: "archived" },
			{ kind: "failed", error: "Suivi unreachable" },
			{ kind: "skipped" },
		]);
		expect(w.files.get(today)).toBe("## Triage\n#bug p3 Ticket t1 ^t1\n");
		expect(w.files.get(daily)).toBe("## Triage\n#bug pz Export vide ^s0001\n");
		expect(w.files.get(widget)).toContain("## Tasks\n- [ ] #task p4 Relancer JMJ ^s0002\n");
		expect(w.app.archivedWith).toEqual([["t3", "Doublon"]]);
		expect(w.app.held.get("t4")!.triaged).toBe(false);
		expect(w.app.held.get("t2")!.triaged).toBe(false);
		expect(w.app.held.get("t5")!.triaged).toBe(false);
		expect(w.app.deck.at).not.toBeNull();
	});

	it("keeps a Sweep line kept, and goes on past a line gone from its note", async () => {
		const w = await world([]);
		const gone = { ...w.swept("s0001"), id: "s9999" };
		const s = after(startSession(sweepItems([gone, w.swept("s0002")], "2026-11-04"), { projects: [], zones: [] }), "z", "Enter", "Enter");
		const end = await commit(s, w.deps);
		expect(end.results).toEqual([{ kind: "failed", error: "ligne introuvable dans la note" }, { kind: "kept" }]);
		expect((await w.app.remote.fullState()).items.find((i) => i.id === "s0002")).toMatchObject({ kept_until: "2026-11-04" });
	});

	it("tells what a written Ticket's write had to say (images not copied)", async () => {
		const w = await world([ticket("t1")]);
		const s = after(startSession(ticketItems([ticket("t1")]), { projects: [], zones: [] }), "Enter");
		await commit(s, { ...w.deps, write: async () => ({ outcome: { kind: "written" }, notice: "1 image(s) du ticket non copiée(s)" }) });
		expect(w.notices).toEqual(["1 image(s) du ticket non copiée(s)"]);
	});

	it("counts a write that threw as a failure, the others still written", async () => {
		const w = await world([ticket("t1"), ticket("t2")]);
		const s = after(startSession(ticketItems([ticket("t1"), ticket("t2")]), { projects: [], zones: [] }), "Enter", "Enter");
		let first = true;
		const end = await commit(s, {
			...w.deps,
			write: async (t, c) => {
				if (first) {
					first = false;
					throw new Error("disque plein");
				}
				return w.deps.write(t, c);
			},
		});
		expect(end.results).toEqual([{ kind: "failed", error: "disque plein" }, { kind: "written" }]);
	});
});
