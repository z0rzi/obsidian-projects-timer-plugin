import { describe, expect, it } from "vitest";
import { DECK_KEYS, deckScreen, goTo, press, recordArchive, startSession, ticketItems, type DeckState } from "../src/deck/deckSession";
import { cardDone, commitDone, endTargets, retryFailed } from "../src/deck/deckEnd";
import { chooseMove, sweepItems, withSweepLines } from "../src/deck/sweepSession";
import { lineContext, type SweepCandidate } from "../src/deck/sweep";
import type { InboxTicket } from "../src/remote/api";
import { deckLegend } from "../src/views/deckRender";
import { progressStrip } from "../src/views/deckStripRender";
import { endScreen, sweepList } from "../src/views/deckListRender";
import { pushReport } from "../src/deck/pushReport";
import type { VaultProject } from "../src/inbox/inboxStore";

const widget: VaultProject = { id: "p1abc", path: "2.projects/Widget.md", title: "Widget", private: false };
const context = { projects: [widget], zones: [] };
const KEEP_UNTIL = "2026-11-04";

const line = (id: string, patch: Partial<SweepCandidate> = {}): SweepCandidate => ({
	id,
	path: "1.meetings/2026-10-01 Point JMJ.md",
	line: 1,
	raw: `#bug p3 Ligne ${id} ^${id}`,
	title: `Ligne ${id}`,
	type: "bug",
	priority: 3,
	description: "",
	day: "2026-10-01",
	...patch,
});
const ticket = (id: string, title: string): InboxTicket => ({
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
});

const session = (lines: SweepCandidate[], tickets: InboxTicket[] = [ticket("t1", "Heatmap vide")]): DeckState =>
	startSession([...sweepItems(lines, KEEP_UNTIL), ...ticketItems(tickets)], context);
const after = (s: DeckState, ...keys: string[]) => keys.reduce((state, key) => press(state, key).state, s);

describe("Sweep list: the step and its focus", () => {
	it("opens on the Sweep list, its first row focused; with no candidates on the Tickets", () => {
		const s = session([line("s1"), line("s2")]);
		expect(deckScreen(s)).toBe("sweep");
		expect(s.index).toBe(0);
		expect(deckScreen(session([]))).toBe("ticket");
		expect(deckScreen(startSession([], context))).toBe("empty");
	});

	it("moves between rows with j and k, down to the « Continuer » row", () => {
		const s = session([line("s1"), line("s2")]);
		expect(after(s, "j").index).toBe(1);
		expect(after(s, "j", "j").index).toBe(2);
		expect(deckScreen(after(s, "j", "j", "j"))).toBe("sweep");
		expect(after(s, "j", "j", "j").index).toBe(2);
		expect(after(s, "j", "k").index).toBe(0);
		expect(after(s, "k").index).toBe(0);
	});

	it("records z, m and Enter on the focused row, then focuses the next undecided one, the « Continuer » row once all are decided", () => {
		const s = session([line("s1"), line("s2"), line("s3")]);
		const second = after(s, "j", "z");
		expect(second.decisions.slice(0, 3)).toEqual([null, { kind: "frigo" }, null]);
		expect(second.index).toBe(2);
		const wrapped = after(second, "Enter");
		expect(wrapped.index).toBe(0);
		const moved = chooseMove(press(wrapped, "m").state, { path: widget.path, id: widget.id });
		expect(moved.decisions.slice(0, 3)).toEqual([{ kind: "move", project: { path: widget.path, id: widget.id } }, { kind: "frigo" }, { kind: "keep", until: KEEP_UNTIL }]);
		expect(moved).toMatchObject({ index: 3, sweeping: true });
		expect(deckScreen(moved)).toBe("sweep");
	});

	it("goes on to the Tickets with Enter on « Continuer », rows left undecided not written", () => {
		const s = after(session([line("s1"), line("s2")]), "z", "j", "Enter");
		expect(deckScreen(s)).toBe("ticket");
		expect(s.index).toBe(2);
		expect(s.decisions.slice(0, 2)).toEqual([{ kind: "frigo" }, null]);
	});

	it("goes on to the end screen from « Continuer » when there is no Ticket", () => {
		const s = after(session([line("s1")], []), "z", "Enter");
		expect(deckScreen(s)).toBe("end");
	});

	it("refuses Enter on a line never pushed, in blue, z and m still working", () => {
		const s = session([line("s1", { id: null, raw: "#bug p3 Ligne s1" })]);
		const enter = press(s, "Enter");
		expect(enter.state).toMatchObject({ index: 0, decisions: [null, null], message: { kind: "info" } });
		expect(enter.state.message!.text).not.toContain("Z");
		expect(after(s, "z").decisions[0]).toEqual({ kind: "frigo" });
		expect(press(s, "m").effects).toMatchObject([{ kind: "pickMove" }]);
	});

	it("refuses z, m and Enter on a line no longer in its note", () => {
		const s = withSweepLines(session([line("s1"), line("s2")]), { 0: null, 1: { heading: null, before: [], line: ["#bug p3 Ligne s2 ^s2"], after: [] } });
		for (const key of ["z", "m", "Enter"]) {
			const step = press(s, key);
			expect(step.effects).toEqual([]);
			expect(step.state.decisions[0]).toBeNull();
			expect(step.state.message).toEqual({ kind: "info", text: "ligne introuvable dans la note" });
		}
		expect(after(s, "j", "z").decisions[1]).toEqual({ kind: "frigo" });
	});

	it("has no Z any more", () => {
		expect(DECK_KEYS).not.toContain("Z");
		const s = session([line("s1"), line("s2")]);
		expect(press(s, "Z")).toEqual({ state: s, effects: [] });
	});
});

describe("Sweep list: u across the list and the Tickets", () => {
	it("goes back in the list to the previous decision", () => {
		const s = after(session([line("s1"), line("s2"), line("s3")]), "z", "z");
		expect(s.index).toBe(2);
		expect(after(s, "u").index).toBe(1);
		expect(after(s, "u", "u").index).toBe(0);
		expect(after(s, "u", "u", "u").index).toBe(0);
	});

	it("goes back in the order the decisions were made, once the focus wrapped", () => {
		// s2 then s3 decided: the focus wraps to s1, the only row left.
		const s = after(session([line("s1"), line("s2"), line("s3")]), "j", "z", "z");
		expect(s.index).toBe(0);
		expect(after(s, "u").index).toBe(2);
		expect(after(s, "u", "u").index).toBe(1);
		expect(after(s, "u", "u", "u").index).toBe(1);
	});

	it("goes back from the first Ticket to the list, on its last decision", () => {
		const s = after(session([line("s1"), line("s2")]), "z", "Enter");
		expect(deckScreen(s)).toBe("sweep");
		const onTicket = after(s, "Enter");
		expect(deckScreen(onTicket)).toBe("ticket");
		const back = after(onTicket, "u");
		expect(deckScreen(back)).toBe("sweep");
		expect(back.index).toBe(1);
		// Back on the list, the Tickets are reached again by « Continuer ».
		expect(deckScreen(after(back, "j", "Enter"))).toBe("ticket");
	});

	it("goes back from the end screen to the last Ticket, or the list when there is none", () => {
		const s = after(session([line("s1")]), "z", "Enter", "Enter");
		expect(deckScreen(s)).toBe("end");
		expect(after(s, "u")).toMatchObject({ index: 1, sweeping: false });
		const noTicket = after(session([line("s1")], []), "z", "Enter");
		expect(after(noTicket, "u")).toMatchObject({ index: 0, sweeping: true });
	});

	it("goes to a Sweep row with a click on its dot, from anywhere", () => {
		const s = after(session([line("s1"), line("s2")]), "z", "z", "Enter", "Enter");
		const there = goTo(s, 1);
		expect(there).toMatchObject({ index: 1, sweeping: true });
		expect(goTo(there, 2)).toMatchObject({ index: 2, sweeping: false });
	});
});

describe("End screen: rows and focus", () => {
	/** s1 au frigo, s2 kept, s3 au frigo, s4 undecided; t1 written, t2 skipped. */
	const decided = () => after(session([line("s1"), line("s2"), line("s3"), line("s4")], [ticket("t1", "Heatmap vide"), ticket("t2", "Doublon")]), "z", "Enter", "z", "j", "Enter", "Enter", "s");

	it("lists the Tickets one by one, then the Sweep by outcome, each reopening its first card", () => {
		const s = decided();
		expect(deckScreen(s)).toBe("end");
		expect(endTargets(s)).toEqual([4, 5, 0, 1]);
	});

	it("focuses « Tout écrire » by default, j and k moving over the rows", () => {
		const s = decided();
		expect(s.endRow).toBeNull();
		expect(after(s, "k").endRow).toBe(3);
		expect(after(s, "k", "k", "k", "k", "k").endRow).toBe(0);
		expect(after(s, "k", "j").endRow).toBeNull();
	});

	it("reopens the card of the focused row with Enter: a Ticket, or the Sweep list on its line", () => {
		const s = decided();
		expect(after(s, "k", "k", "k", "k", "Enter")).toMatchObject({ index: 4, sweeping: false });
		expect(after(s, "k", "Enter")).toMatchObject({ index: 1, sweeping: true });
	});

	it("writes with Enter on « Tout écrire », only the decided cards", () => {
		const step = press(decided(), "Enter");
		expect(step.state.phase).toBe("committing");
		expect(step.effects[0]!.kind === "commit" && step.effects[0].cards.map((c) => c.index)).toEqual([0, 1, 2, 4, 5]);
	});
});

describe("Report: retrying the failures", () => {
	it("writes again only the cards that failed, the closing Push's result reset", () => {
		let s = press(after(session([line("s1"), line("s2")], [ticket("t1", "Heatmap vide")]), "z", "z", "Enter", "Enter"), "Enter").state;
		s = cardDone(s, 0, { kind: "failed", error: "ligne introuvable dans la note" });
		s = cardDone(s, 1, { kind: "frigo" });
		s = cardDone(s, 2, { kind: "failed", error: "Suivi unreachable" });
		s = commitDone(s, { tone: "done", text: "Balayage poussé vers Suivi : 1 changement" });
		expect(s).toMatchObject({ phase: "done", pushed: { tone: "done" } });
		const retry = retryFailed(s);
		expect(retry.state).toMatchObject({ phase: "committing", pushed: null, results: [null, { kind: "frigo" }, null] });
		expect(retry.effects[0]!.kind === "commit" && retry.effects[0].cards.map((c) => c.index)).toEqual([0, 2]);
		expect(retryFailed(retry.state)).toEqual({ state: retry.state, effects: [] });
	});
});

describe("Sweep line context", () => {
	const note = [
		"# Point JMJ",
		"intro",
		"## Suivi JMJ",
		"- point sur l'export",
		"",
		"- autre",
		"- encore",
		"#task p0 envoyer algo ^wn38f",
		"\t[[Widget]]",
		"\tdétail",
		"Envoyer à Alexandre:",
		"- un",
		"- deux",
		"- trois",
	].join("\n");

	it("gives the nearest heading above, up to three lines before and after, and the line with its body", () => {
		expect(lineContext(note, { id: "wn38f", line: 7, raw: "#task p0 envoyer algo ^wn38f" })).toEqual({
			heading: "## Suivi JMJ",
			before: ["- point sur l'export", "- autre", "- encore"],
			line: ["#task p0 envoyer algo ^wn38f", "\t[[Widget]]", "\tdétail"],
			after: ["Envoyer à Alexandre:", "- un", "- deux"],
		});
	});

	it("stops the lines before at the heading, and finds a line not pushed by its text", () => {
		const short = ["## Suivi", "#bug p3 Export vide", "fin"].join("\n");
		expect(lineContext(short, { id: null, line: 5, raw: "#bug p3 Export vide" })).toEqual({ heading: "## Suivi", before: [], line: ["#bug p3 Export vide"], after: ["fin"] });
	});

	it("is null for a line no longer in the note", () => {
		expect(lineContext(note, { id: "zzzzz", line: 7, raw: "#task p0 x ^zzzzz" })).toBeNull();
		expect(lineContext(note, { id: null, line: 2, raw: "#bug p3 parti" })).toBeNull();
	});
});

describe("Sweep list: what each row shows", () => {
	const lines = () => [
		line("s1", { title: "Export vide" }),
		line("s2", { id: null, raw: "#task p2 Revoir les unités", title: "Revoir les unités", type: "task", priority: 2 }),
		line("s3", { path: "1.meetings/2026-10-08.md", day: "2026-10-08", type: "quick", priority: "pq", title: "Bouton déborde" }),
		line("s4", { path: "1.meetings/2026-09-01 Revue.md", day: "2026-09-01", priority: 4 }),
	];
	const TODAY = "2026-10-28";

	it("groups the lines by note, oldest first, each headed by its date and title", () => {
		const s = session([lines()[3]!, ...lines().slice(0, 3)]);
		expect(sweepList(s, TODAY).groups.map((g) => [g.path, g.header, g.rows.map((r) => r.index)])).toEqual([
			["1.meetings/2026-09-01 Revue.md", "2026-09-01 · Revue", [0]],
			["1.meetings/2026-10-01 Point JMJ.md", "2026-10-01 · Point JMJ", [1, 2]],
			["1.meetings/2026-10-08.md", "2026-10-08", [3]],
		]);
	});

	it("gives each row its type, Priority, age as a bar full at 30 days, and « non poussée » for a line without an id", () => {
		const rows = sweepList(session(lines()), TODAY).groups.flatMap((g) => g.rows);
		expect(rows.map((r) => [r.title, r.tag, r.type, r.priority, r.age, r.ageFraction, r.notPushed])).toEqual([
			["Export vide", "#bug", "bug", { key: "p3", label: "P3" }, "27 j", 0.9, false],
			["Revoir les unités", "#task", "task", { key: "p2", label: "P2" }, "27 j", 0.9, true],
			["Bouton déborde", "#quick", "quick", { key: "pq", label: "Rapide" }, "20 j", 2 / 3, false],
			["Ligne s4", "#bug", "bug", { key: "p4", label: "P4" }, "57 j", 1, false],
		]);
	});

	it("says each row's recorded decision in words, with its mark", () => {
		const s = chooseMove(press(after(session(lines()), "z", "j", "Enter"), "m").state, { path: widget.path, id: widget.id });
		const rows = sweepList(s, TODAY).groups.flatMap((g) => g.rows);
		expect(rows.map((r) => r.decision)).toEqual([
			{ label: "frigo", mark: "frigo" },
			null,
			{ label: "gardée", mark: "kept" },
			{ label: "déplacée → Widget", mark: "moved" },
		]);
	});

	it("opens the focused row only, on its context once read, or says it is no longer in its note", () => {
		const context = { heading: "## Suivi", before: ["- avant"], line: ["#bug p3 Ligne s2 ^s2"], after: [] };
		const s = withSweepLines(session([line("s1"), line("s2")]), { 0: null, 1: context });
		const rows = (state: DeckState) => sweepList(state, TODAY).groups[0]!.rows;
		expect(rows(s).map((r) => [r.focused, r.context])).toEqual([
			[true, "missing"],
			[false, undefined],
		]);
		expect(rows(after(s, "j"))[1]).toMatchObject({ focused: true, context });
		expect(rows(session([line("s1")]))[0]!.context).toBeUndefined();
	});

	it("ends on « Continuer vers les tickets (n) », or « Fin » without Tickets, focused past the last row", () => {
		const s = session([line("s1")], [ticket("t1", "a"), ticket("t2", "b")]);
		expect(sweepList(s, TODAY).continueRow).toEqual({ label: "→ Continuer vers les tickets (2)", focused: false });
		expect(sweepList(after(s, "z"), TODAY).continueRow.focused).toBe(true);
		expect(sweepList(session([line("s1")], []), TODAY).continueRow.label).toBe("→ Fin");
	});

	it("has its own legend: j k, z, m, Enter with the keep's day, u", () => {
		expect(deckLegend(session([line("s1")])).map((l) => [l.keys, l.label])).toEqual([
			[["j", "k"], "ligne"],
			[["z"], "au frigo"],
			[["m"], "déplacer"],
			[["Enter"], "garder jusqu'au 04/11"],
			[["u"], "retour"],
		]);
	});
});

describe("End screen and report: what they show", () => {
	/** s1 au frigo, s2 moved, s3 au frigo; t1 written p0, t2 archived « déjà fait », t3 skipped. */
	const full = () => {
		let s = after(session([line("s1", { title: "Export vide" }), line("s2", { title: "Unités" }), line("s3", { title: "Bouton" })], [ticket("t1", "Heatmap vide"), ticket("t2", "Doublon"), ticket("t3", "Question")]), "z");
		s = chooseMove(press(s, "m").state, { path: widget.path, id: widget.id });
		s = after(s, "z", "Enter", "Enter");
		s = recordArchive(press(s, "x").state, "déjà fait");
		return after(s, "s");
	};

	it("lists the Tickets one row each, with type, Priority and what will happen, then the Sweep by outcome", () => {
		const end = endScreen(full());
		expect(end.tickets.map((r) => [r.title, r.type, r.priority, r.action, r.status, r.focused])).toEqual([
			["Heatmap vide", "bug", { key: "p0", label: "P0" }, "✎ écrire", null, false],
			["Doublon", null, null, "🗄 archiver « déjà fait »", null, false],
			["Question", null, null, "⏭ passer", null, false],
		]);
		expect(end.sweep.map((g) => [g.label, g.lines.map((l) => [l.title, l.detail])])).toEqual([
			["au frigo (2)", [["Export vide", null], ["Bouton", null]]],
			["déplacées (1)", [["Unités", "→ Widget"]]],
		]);
		expect(end.write).toEqual({ label: "Tout écrire (6)", focused: true });
		expect(end.retry).toBe(false);
	});

	it("moves its focus with j and k over the Tickets, then the Sweep groups", () => {
		const end = endScreen(after(full(), "k"));
		expect(end.sweep.map((g) => g.focused)).toEqual([false, true]);
		expect(end.write!.focused).toBe(false);
		expect(endScreen(after(full(), "k", "k", "k", "k", "k")).tickets[0]!.focused).toBe(true);
	});

	it("shows « Envoi… » on each row being written, then its result: ✓, ⓘ in blue for a Ticket no longer to triage, ✕ in red", () => {
		let s = press(full(), "Enter").state;
		expect(endScreen(s).write).toBeNull();
		expect(endScreen(s).tickets[0]!.status).toEqual({ tone: "sending", text: "Envoi…" });
		s = cardDone(s, 0, { kind: "frigo" });
		s = cardDone(s, 1, { kind: "failed", error: "ligne introuvable dans la note" });
		s = cardDone(s, 3, { kind: "written" });
		s = cardDone(s, 4, { kind: "stale" });
		s = cardDone(s, 5, { kind: "skipped" });
		expect(endScreen(s).tickets.map((r) => r.status)).toEqual([
			{ tone: "done", text: "✓ écrite" },
			{ tone: "info", text: "ⓘ plus à trier : retirée ou modifiée" },
			{ tone: "done", text: "✓ passée" },
		]);
		expect(endScreen(s).sweep.flatMap((g) => g.lines.map((l) => l.status))).toEqual([
			{ tone: "done", text: "✓ au frigo" },
			{ tone: "sending", text: "Envoi…" },
			{ tone: "error", text: "✕ ligne introuvable dans la note" },
		]);
		s = cardDone(s, 2, { kind: "frigo" });
		const done = commitDone(s, { tone: "done", text: "Balayage poussé vers Suivi : 2 changements" });
		expect(endScreen(done)).toMatchObject({ write: null, retry: true, push: { tone: "done", text: "Balayage poussé vers Suivi : 2 changements" } });
		expect(deckLegend(done)).toEqual([]);
	});

	it("words the closing Push's result", () => {
		expect(pushReport(null)).toBeNull();
		expect(pushReport({ applied: 0, failed: [] })).toBeNull();
		expect(pushReport({ applied: 1, failed: [] })).toEqual({ tone: "done", text: "Balayage poussé vers Suivi : 1 changement" });
		expect(pushReport({ applied: 4, failed: [] })).toEqual({ tone: "done", text: "Balayage poussé vers Suivi : 4 changements" });
		expect(pushReport({ applied: 1, failed: [{ title: "Export vide", error: "409" }] })).toEqual({
			tone: "error",
			text: "Balayage poussé vers Suivi : 1 changement ; en échec : Export vide : 409",
		});
		expect(pushReport(new Error("Suivi unreachable"))).toEqual({ tone: "error", text: "Push du balayage impossible (Suivi unreachable) : lancez le Push." });
	});

	it("has its legend: j k, Enter on a row or « Tout écrire », u", () => {
		expect(deckLegend(full()).map((l) => [l.keys, l.label])).toEqual([
			[["j", "k"], "ligne"],
			[["Enter"], "sur une ligne : la rouvrir"],
			[["Enter"], "« Tout écrire »"],
			[["u"], "retour"],
		]);
	});
});

describe("Nothing to triage", () => {
	it("has no legend and no strip", () => {
		const s = startSession([], context);
		expect(deckLegend(s)).toEqual([]);
		expect(progressStrip(s)).toBeNull();
	});
});
