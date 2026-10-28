import { describe, expect, it } from "vitest";
import { archiveTicket, writeTicket } from "../src/deck/deckRun";
import { press, startSession, type DeckState } from "../src/deck/deckSession";
import type { DeckChoice } from "../src/deck/ticketLine";
import type { TriageDeps } from "../src/inbox/triage";
import type { InboxTicket, Zone } from "../src/remote/api";
import { appTask, fakeLinks, fakeSuivi } from "./fakeSuivi";

const today = "1.meetings/2026-10-27.md";
const widget = "2.projects/Widget.md";

const ticket = (id: string, patch: Partial<InboxTicket> = {}): InboxTicket => ({
	id,
	type: "bug",
	title: "Heatmap vide",
	description: "Rien ne s'affiche",
	created_at: "2026-10-20T10:00:00.000Z",
	changed_at: "2026-10-20T10:00:00.000Z",
	author_email: "jmj@edf.fr",
	urgency: "genant",
	requested_priority: null,
	project_id: null,
	zone_id: null,
	...patch,
});

/** A Ticket À trier as the app holds it. */
const toTriage = (t: InboxTicket) =>
	appTask(t.id, { title: t.title, type: t.type, priority: null, description: t.description }, { triaged: false });

/** The fake app holding `tickets` À trier (and `items`), today's Daily note in memory. */
function world(
	tickets: InboxTicket[],
	notes = new Map<string, string>([[widget, "---\nsuivi_id: p1abc\n---\n# Widget"]]),
	zones: Zone[] | null = [{ id: 3, name: "Heatmap", path: "" }],
) {
	const app = fakeSuivi(tickets.map(toTriage));
	// The Client's Zone suggestion, held by the app with the Ticket.
	for (const t of tickets) app.held.get(t.id)!.fields.zone_id = t.zone_id;
	const deps: TriageDeps = {
		remote: app.remote,
		dailyNote: today,
		heading: "## Triage",
		template: async () => "",
		async write(path, edit) {
			const content = edit(notes.get(path) ?? null);
			notes.set(path, content);
			return content;
		},
		linkText: (path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
		projects: { links: fakeLinks(() => [...notes.keys()]), isProject: (p) => p.startsWith("2.projects/") },
		appUrl: "https://suivi.test/",
	};
	const session = startSession(
		tickets.map((t) => ({ kind: "ticket", ticket: t })),
		{ projects: [{ id: "p1abc", path: widget, title: "Widget", private: false }], zones },
	);
	return { app, deps, notes, session };
}

/** The Ticket of card `index` and the line Enter recorded for it, as the commit writes it. */
function recorded(s: DeckState, index = 0): { ticket: InboxTicket; choice: DeckChoice } {
	const decision = s.decisions[index];
	const item = s.items[index]!;
	if (decision?.kind !== "write" || item.kind !== "ticket") throw new Error("no line recorded");
	return { ticket: item.ticket, choice: decision.choice };
}

describe("The Deck's writes, against the fake app", () => {
	it("keeps the Client's Zone when the Deck could not load the app's Zones: the request names none", async () => {
		const w = world([ticket("t1aaa", { zone_id: 3 })], undefined, null);
		const effect = recorded(press(w.session, "Enter").state);
		const { outcome } = await writeTicket(effect.ticket, effect.choice, w.deps);
		expect(outcome).toEqual({ kind: "written" });
		expect(w.app.triageRequests.at(-1)!).not.toHaveProperty("zone_id");
		expect(w.app.held.get("t1aaa")!.fields.zone_id).toBe(3);
	});

	it("skips a Ticket its author edited since the Deck showed it: the app answers 409 to `expected`, nothing written", async () => {
		const w = world([ticket("t1aaa")]);
		w.app.editTicket("t1aaa", { title: "Heatmap toujours vide" }, "2026-10-21T08:00:00.000Z");
		const effect = recorded(press(w.session, "Enter").state);
		const { outcome } = await writeTicket(effect.ticket, effect.choice, w.deps);
		expect(outcome).toEqual({ kind: "stale" });
		expect(w.notes.get(today)).toBeUndefined();
		expect(w.app.held.get("t1aaa")!.triaged).toBe(false);
	});

	it("writes the line recorded with Enter into today's Daily note, Triaged in the app", async () => {
		const first = ticket("t1aaa", { project_id: "p1abc", zone_id: 3 });
		const w = world([first, ticket("t2bbb", { title: "Export lent" })]);
		const effect = recorded(press(w.session, "Enter").state);
		const { outcome } = await writeTicket(effect.ticket, effect.choice, w.deps);
		expect(outcome).toEqual({ kind: "written" });
		expect(w.notes.get(today)).toBe("## Triage\n#bug pz Heatmap vide ^t1aaa\n\t[[Widget]]\n\tRien ne s'affiche\n");
		const held = (await w.app.remote.state()).find((i) => i.id === "t1aaa")!;
		expect(held).toMatchObject({ triaged: true, fields: { type: "bug", priority: "pz", project_id: "p1abc", zone_id: 3 } });
	});

	it("fails on a ranked Rapide the app refuses, as the app words it, nothing written and the Ticket still to triage", async () => {
		const w = world([ticket("t1aaa", { type: "quick" })]);
		const { outcome } = await writeTicket(w.session.items[0]!.ticket, { type: "quick", priority: 2, project: null }, w.deps);
		expect(outcome).toEqual({ kind: "failed", error: "Suivi error (HTTP 400): Une tâche rapide n'a pas de priorité" });
		expect(w.notes.get(today)).toBeUndefined();
		expect(w.app.held.get("t1aaa")!.triaged).toBe(false);
	});

	it("proposes the Priority the Client chose for a Gênant métier Ticket, and the Frigo for a Gênant bug", async () => {
		const w = world([ticket("t1aaa", { type: "task", requested_priority: 4 }), ticket("t2bbb")]);
		const both = press(press(w.session, "Enter").state, "Enter").state;
		const effect = recorded(both);
		await writeTicket(effect.ticket, effect.choice, w.deps);
		expect(w.app.held.get("t1aaa")!).toMatchObject({ triaged: true, fields: { type: "task", priority: 4 } });
		const next = recorded(both, 1);
		await writeTicket(next.ticket, next.choice, w.deps);
		expect(w.app.held.get("t2bbb")!).toMatchObject({ triaged: true, fields: { type: "bug", priority: "pz" } });
		expect(w.notes.get(today)).toBe("## Triage\n#task p4 Heatmap vide ^t1aaa\n\tRien ne s'affiche\n#bug pz Heatmap vide ^t2bbb\n\tRien ne s'affiche\n");
	});

	it("writes a Rapide without a token", async () => {
		const w = world([ticket("t1aaa", { type: "quick" })]);
		const effect = recorded(press(w.session, "Enter").state);
		await writeTicket(effect.ticket, effect.choice, w.deps);
		expect(w.notes.get(today)).toBe("## Triage\n#quick Heatmap vide ^t1aaa\n\tRien ne s'affiche\n");
	});

	it("answers stale, writing nothing, for a Ticket triaged or withdrawn meanwhile", async () => {
		const w = world([ticket("t1aaa"), ticket("t2bbb")]);
		await w.app.remote.triage("t1aaa", { as: "task", type: "bug", priority: 2, project_id: null });
		await w.app.remote.archiveTicket("t2bbb", null);
		const choice = { type: "bug", priority: 1, project: null, zone: null } as const;
		expect((await writeTicket(ticket("t1aaa"), choice, w.deps)).outcome).toEqual({ kind: "stale" });
		expect((await writeTicket(ticket("t2bbb"), choice, w.deps)).outcome).toEqual({ kind: "stale" });
		expect(w.notes.has(today)).toBe(false);
	});

	it("tells of the images it could not copy, and a failure as one", async () => {
		const w = world([ticket("t1aaa", { description: "![](/uploads/a.png)" })]);
		w.app.held.get("t1aaa")!.fields.description = "![](/uploads/a.png)";
		const choice = { type: "bug", priority: 1, project: null, zone: null } as const;
		const { notice } = await writeTicket(ticket("t1aaa"), choice, { ...w.deps, localImage: async () => Promise.reject(new Error("offline")) });
		expect(notice).toBe("1 image(s) du ticket non copiée(s) dans le coffre : le lien vers l'app est gardé.");
		const down = { ...w.deps, remote: { ...w.app.remote, triage: async () => Promise.reject(new Error("Suivi unreachable")) } };
		expect((await writeTicket(ticket("t1aaa"), choice, down)).outcome).toEqual({ kind: "failed", error: "Suivi unreachable" });
	});

	it("goes on, telling why, when the app triaged the Ticket but the note could not be written", async () => {
		const w = world([ticket("t1aaa")]);
		const choice = { type: "bug", priority: 1, project: null, zone: null } as const;
		const broken = { ...w.deps, write: async () => Promise.reject(new Error("disque plein")) };
		const { outcome, notice } = await writeTicket(ticket("t1aaa"), choice, broken);
		expect(outcome).toEqual({ kind: "written" });
		expect(notice).toBe("Heatmap vide : triée dans l'app, mais pas écrite (disque plein) : le prochain Pull la proposera à insérer");
	});

	it("archives with the comment given, stale for a Ticket no longer À trier", async () => {
		const w = world([ticket("t1aaa"), ticket("t2bbb")]);
		expect(await archiveTicket(ticket("t1aaa"), "Doublon", w.app.remote)).toEqual({ kind: "archived" });
		expect(w.app.archivedWith).toEqual([["t1aaa", "Doublon"]]);
		expect((await w.app.remote.state()).find((i) => i.id === "t1aaa")!.archived).toBe(true);
		expect(await archiveTicket(ticket("t1aaa"), null, w.app.remote)).toEqual({ kind: "stale" });
		await w.app.remote.triage("t2bbb", { as: "task", type: "bug", priority: 2, project_id: null });
		expect(await archiveTicket(ticket("t2bbb"), null, w.app.remote)).toEqual({ kind: "stale" });
	});
});
