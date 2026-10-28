import { describe, expect, it } from "vitest";
import { DECK_LEGEND, fieldRows, frenchDateTime, ticketSide, type DeckChip, type DeckFieldRow } from "../src/views/deckRender";
import { DECK_KEYS, press, startSession, ticketItems, type DeckState } from "../src/deck/deckSession";
import { choose } from "../src/deck/ticketSession";
import type { DeckContext } from "../src/deck/ticketLine";
import type { InboxTicket, Zone } from "../src/remote/api";
import type { VaultProject } from "../src/inbox/inboxStore";

const widget: VaultProject = { id: "p1abc", path: "2.projects/Widget.md", title: "Widget", private: false };
const carte: VaultProject = { id: "p2def", path: "2.projects/Carte.md", title: "Carte", private: false };
const export_: VaultProject = { id: "p3ghi", path: "2.projects/Export.md", title: "Export", private: false };
const zones: Zone[] = [
	{ id: 1, name: "Heatmap", path: "/carte" },
	{ id: 2, name: "Accueil", path: "" },
	{ id: 3, name: "Export", path: "/donnees" },
];
const context: DeckContext = { projects: [widget, carte, export_], zones };
const ticket = (patch: Partial<InboxTicket> = {}): InboxTicket => ({
	id: "t7f3a",
	type: "bug",
	title: "Heatmap vide",
	description: "Rien ne s'affiche",
	created_at: "2026-10-26T13:05:00.000Z",
	changed_at: "2026-10-26T13:05:00.000Z",
	author_email: "jmj@edf.fr",
	urgency: "genant",
	requested_priority: null,
	project_id: null,
	zone_id: null,
	...patch,
});
const session = (t: InboxTicket, ctx: DeckContext = context): DeckState => startSession(ticketItems([t]), ctx);
const keys = (s: DeckState, ...pressed: string[]) => pressed.reduce((state, key) => press(state, key).state, s);
const row = (s: DeckState, field: DeckFieldRow["field"]) => fieldRows(s).find((r) => r.field === field)!;
const selected = (r: DeckFieldRow) => r.chips.filter((c) => c.selected).map((c) => c.label);
const client = (r: DeckFieldRow) => r.chips.filter((c) => c.client).map((c) => c.label);

describe("Deck card: the Ticket on the left", () => {
	it("gives the title, the urgency as a badge, the author and a French weekday date", () => {
		expect(ticketSide(ticket(), "https://suivi.example")).toMatchObject({
			title: "Heatmap vide",
			badge: { label: "Gênant", urgency: "genant" },
			byline: "jmj@edf.fr · lundi 26 oct. 14:05",
		});
		expect(ticketSide(ticket({ urgency: "bloquant" }), "").badge).toEqual({ label: "Bloquant", urgency: "bloquant" });
		expect(ticketSide(ticket({ urgency: "plus_tard" }), "").badge).toEqual({ label: "Pour plus tard", urgency: "plus_tard" });
	});

	it("shows a Nouveau chantier as a neutral badge, nothing for a Ticket sent before the question", () => {
		expect(ticketSide(ticket({ type: "idea", urgency: null }), "").badge).toEqual({ label: "Nouveau chantier", urgency: null });
		expect(ticketSide(ticket({ urgency: null }), "").badge).toBeNull();
	});

	it("takes the uploaded images out of the description, as thumbnails loading from the app first", () => {
		const side = ticketSide(
			ticket({ description: "Vide.\n\n![carte](/uploads/a.png)\n\nVoir [la tâche](/taches/12) ![](/uploads/b.png) ![carte](/uploads/a.png)" }),
			"https://suivi.example/",
		);
		expect(side.description).toBe("Vide.\n\n\n\nVoir [la tâche](https://suivi.example/taches/12)");
		expect(side.images).toEqual([
			{ path: "/uploads/a.png", alt: "carte", src: "https://suivi.example/uploads/a.png" },
			{ path: "/uploads/b.png", alt: "", src: "https://suivi.example/uploads/b.png" },
		]);
	});

	it("writes dates as a French weekday and day, the month short", () => {
		expect(frenchDateTime("2026-05-02T07:30:00.000Z")).toBe("samedi 2 mai 09:30");
		expect(frenchDateTime("2026-02-01T23:00:00.000Z")).toBe("lundi 2 févr. 00:00");
	});
});

describe("Deck card: the Type row", () => {
	it("has every type with its key and colour, the chosen one selected, the Client's marked", () => {
		const r = row(session(ticket()), "type");
		expect(r.chips.map((c) => [c.label, c.key, c.type])).toEqual([
			["#task", "t", "task"],
			["#bug", "b", "bug"],
			["#quick", "q", "quick"],
			["#wait", "w", "wait"],
			["#idea", "i", "idea"],
		]);
		expect(selected(r)).toEqual(["#bug"]);
		expect(client(r)).toEqual(["#bug"]);
		expect(r.modified).toBe(false);
	});

	it("says « modifié » once the type differs from the Client's", () => {
		const r = row(keys(session(ticket()), "t"), "type");
		expect([selected(r), client(r), r.modified]).toEqual([["#task"], ["#bug"], true]);
		expect(row(keys(session(ticket()), "t", "b"), "type").modified).toBe(false);
	});

	it("marks the Client's answer for every kind of Ticket", () => {
		for (const type of ["bug", "quick", "task", "idea"] as const) expect(client(row(session(ticket({ type })), "type"))).toEqual([`#${type}`]);
	});
});

describe("Deck card: the Priorité row", () => {
	it("shows P0 to P5, Rapide and Frigo with their keys and colours", () => {
		const r = row(session(ticket()), "priority");
		expect(r.chips.map((c) => [c.label, c.key, c.priority])).toEqual([
			["P0", "0", "p0"],
			["P1", "1", "p1"],
			["P2", "2", "p2"],
			["P3", "3", "p3"],
			["P4", "4", "p4"],
			["P5", "5", "p5"],
			["Rapide", "q", "pq"],
			["Frigo", "z", "pz"],
		]);
	});

	it("marks the Priority the Client's answers suggest, for every Urgency", () => {
		const marked = (patch: Partial<InboxTicket>) => client(row(session(ticket(patch)), "priority"));
		expect(marked({ urgency: "bloquant" })).toEqual(["P0"]);
		expect(marked({ urgency: "genant" })).toEqual(["Frigo"]);
		expect(marked({ urgency: "genant", type: "quick" })).toEqual(["Rapide"]);
		expect(marked({ urgency: "genant", type: "task" })).toEqual(["P2"]);
		expect(marked({ urgency: "plus_tard", type: "task" })).toEqual(["Frigo"]);
		expect(marked({ urgency: null, type: "idea" })).toEqual(["Frigo"]);
	});

	it("marks the Priority the Client chose on a Gênant métier demande", () => {
		const r = row(session(ticket({ type: "task", urgency: "genant", requested_priority: 4 })), "priority");
		expect([selected(r), client(r), r.modified]).toEqual([["P4"], ["P4"], false]);
	});

	it("says « modifié » when the Priority chosen is not the Client's", () => {
		const r = row(keys(session(ticket()), "1"), "priority");
		expect([selected(r), client(r), r.modified]).toEqual([["P1"], ["Frigo"], true]);
	});

	it("keeps the Client's mark on his type's Priority when the type changes", () => {
		const r = row(keys(session(ticket({ type: "task", urgency: "genant", requested_priority: 3 })), "q"), "priority");
		expect([selected(r), client(r), r.modified]).toEqual([["Rapide"], ["P3"], true]);
	});
});

describe("Deck card: the Projet row", () => {
	it("shows the Client's Project and « aucun », the full search on `p`", () => {
		const r = row(session(ticket({ project_id: "p1abc" })), "project");
		expect(r.chips.map((c) => [c.label, c.selected, c.client])).toEqual([
			["Widget", true, true],
			["aucun", false, false],
		]);
		expect([r.modified, r.search]).toEqual([false, "p"]);
		expect(r.chips.every((c) => c.key === null)).toBe(true);
	});

	it("shows only « aucun » when the Client did not know", () => {
		const r = row(session(ticket()), "project");
		expect(r.chips.map((c) => [c.label, c.selected, c.client])).toEqual([["aucun", true, false]]);
		expect(r.modified).toBe(false);
	});

	it("puts a Project picked first, then the Client's, then « aucun »", () => {
		const s = choose(session(ticket({ project_id: "p1abc" })), "project", { path: carte.path, id: carte.id });
		const r = row(s, "project");
		expect(r.chips.map((c) => [c.label, c.selected, c.client])).toEqual([
			["Carte", true, false],
			["Widget", false, true],
			["aucun", false, false],
		]);
		expect(r.modified).toBe(true);
	});

	it("strikes an unknown Client Project: not in the vault, never selected", () => {
		const r = row(session(ticket({ project_id: "p9out" })), "project");
		expect(r.chips).toEqual<DeckChip[]>([
			expect.objectContaining({ label: "(pas dans le vault)", selected: false, client: true, struck: true }),
			expect.objectContaining({ label: "aucun", selected: true, client: false, struck: false }),
		]);
		expect(r.modified).toBe(true);
	});

	it("cycles `h`/`l` over the visible chips only, stopping at the ends", () => {
		const s = { ...choose(session(ticket({ project_id: "p1abc" })), "project", { path: carte.path, id: carte.id }), field: "project" as const };
		expect(keys(s, "l").choices["t7f3a"]!.project).toEqual({ path: widget.path, id: widget.id });
		expect(keys(s, "l", "l").choices["t7f3a"]!.project).toBeNull();
		expect(keys(s, "l", "l", "l").choices["t7f3a"]!.project).toBeNull();
		expect(keys(s, "l", "l", "h").choices["t7f3a"]!.project).toEqual({ path: widget.path, id: widget.id });
		expect(keys(s, "h").choices["t7f3a"]!.project).toEqual({ path: carte.path, id: carte.id });
	});

	it("keeps a Project picked on the row once `h`/`l` move off it, until another pick replaces it", () => {
		const s = { ...choose(session(ticket({ project_id: "p1abc" })), "project", { path: carte.path, id: carte.id }), field: "project" as const };
		const off = keys(s, "l");
		expect(row(off, "project").chips.map((c) => [c.label, c.selected])).toEqual([
			["Carte", false],
			["Widget", true],
			["aucun", false],
		]);
		expect(keys(off, "h").choices["t7f3a"]!.project).toEqual({ path: carte.path, id: carte.id });
		expect(keys(s, "l", "l", "h", "h").choices["t7f3a"]!.project).toEqual({ path: carte.path, id: carte.id });
		const replaced = choose(off, "project", { path: export_.path, id: export_.id });
		expect(row(replaced, "project").chips.map((c) => c.label)).toEqual(["Export", "Widget", "aucun"]);
	});

	it("never cycles onto an unknown Client Project", () => {
		const s = keys(session(ticket({ project_id: "p9out" })), "j", "j");
		expect(keys(s, "h").choices["t7f3a"]!.project).toBeNull();
		expect(keys(s, "l").choices["t7f3a"]!.project).toBeNull();
	});

	it("still opens the full search on `p`", () => {
		expect(press(session(ticket()), "p").effects).toEqual([{ kind: "pick", field: "project", ticket: ticket() }]);
	});
});

describe("Deck card: the Zone row", () => {
	it("shows the Client's Zone with its path, and « aucune », the full search on `o`", () => {
		const r = row(session(ticket({ zone_id: 1 })), "zone");
		expect(r.chips.map((c) => [c.label, c.detail, c.selected, c.client])).toEqual([
			["Heatmap", "/carte", true, true],
			["aucune", null, false, false],
		]);
		expect([r.modified, r.search]).toEqual([false, "o"]);
	});

	it("puts a Zone picked first, says « modifié », and cycles over the visible chips", () => {
		const s = { ...choose(session(ticket({ zone_id: 1 })), "zone", 2), field: "zone" as const };
		const r = row(s, "zone");
		expect(r.chips.map((c) => [c.label, c.detail, c.selected])).toEqual([
			["Accueil", null, true],
			["Heatmap", "/carte", false],
			["aucune", null, false],
		]);
		expect(r.modified).toBe(true);
		expect(keys(s, "l").choices["t7f3a"]!.zone).toBe(1);
		expect(keys(s, "l", "l").choices["t7f3a"]!.zone).toBeNull();
		expect(keys(s, "l", "l", "l").choices["t7f3a"]!.zone).toBeNull();
	});

	it("keeps a Zone picked on the row once `h`/`l` move off it, until another pick replaces it", () => {
		const s = { ...choose(session(ticket({ zone_id: 1 })), "zone", 2), field: "zone" as const };
		const off = keys(s, "l", "l");
		expect(row(off, "zone").chips.map((c) => [c.label, c.selected])).toEqual([
			["Accueil", false],
			["Heatmap", false],
			["aucune", true],
		]);
		expect(keys(off, "h", "h").choices["t7f3a"]!.zone).toBe(2);
		expect(row(choose(off, "zone", 3), "zone").chips.map((c) => c.label)).toEqual(["Export", "Heatmap", "aucune"]);
	});

	it("shows one disabled chip when the Zones are not loaded, nothing to cycle or search", () => {
		const s = keys(session(ticket({ zone_id: 1 }), { projects: [widget], zones: null }), "j", "j", "j");
		const r = row(s, "zone");
		expect(r.chips).toEqual([expect.objectContaining({ label: "zones non chargées", disabled: true, selected: false, client: false })]);
		expect([r.modified, r.search]).toEqual([false, null]);
		expect(keys(s, "l").choices["t7f3a"]).toEqual(s.choices["t7f3a"]);
		expect(press(s, "o").effects).toEqual([]);
	});
});

describe("Deck card: the legend", () => {
	it("keeps the moves and the actions on one line, the type and Priority keys being on their chips", () => {
		expect(DECK_LEGEND.map(({ keys, label }) => `${keys.join(" ")} ${label}`)).toEqual([
			"j k champ",
			"h l valeur",
			"Enter écrire",
			"x archiver",
			"s passer",
			". comme le précédent",
			"u retour",
		]);
		const onChips = fieldRows(session(ticket())).flatMap((r) => [...r.chips.flatMap((c) => (c.key ? [c.key] : [])), ...(r.search ? [r.search] : [])]);
		const shown = new Set<string>([...DECK_LEGEND.flatMap((l) => l.keys), ...onChips]);
		// The Sweep's key `m` is on its own legend.
		expect(DECK_KEYS.filter((k) => !shown.has(k) && k !== "m")).toEqual([]);
	});
});
