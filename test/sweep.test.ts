import { describe, expect, it } from "vitest";
import { firstSessionToday, sweepCandidates, type SweepNote, type SweepOptions } from "../src/deck/sweep";
import type { ItemState } from "../src/remote/api";
import { appTask } from "./fakeSuivi";

const TODAY = "2026-10-28";
const options: SweepOptions = { folder: "1.meetings", format: "YYYY-MM-DD", age: 7, isProject: (path) => path.startsWith("2.projects/") };

/** A note of the vault: its path, content and creation time (ms). */
const note = (path: string, content: string, ctime = Date.parse("2026-10-27T09:00:00")): SweepNote => ({
	path,
	basename: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
	content,
	ctime,
});

/** The app holding Tasks `ids`, each open, `kept` giving a `kept_until`. */
const state = (ids: string[], kept: Record<string, string> = {}): ItemState[] =>
	ids.map((id) => ({ ...appTask(id, { title: id }), kept_until: kept[id] ?? null }) as ItemState);

const ids = (notes: SweepNote[], items: ItemState[], opts = options) => sweepCandidates(notes, items, opts, TODAY).map((c) => c.id);

describe("Sweep candidates", () => {
	it("are the open Tag tasks of Daily notes older than the sweep age, not at PZ, P0 or P1, #quick included", () => {
		const daily = note(
			"1.meetings/2026-10-20.md",
			[
				"## Triage",
				"#bug p3 Export vide ^s1",
				"\tLe bouton ne fait rien",
				"#task p1 Urgent ^s2",
				"#task p0 En cours ^s3",
				"#task pz Plus tard ^s4",
				"#quick Marge du titre ^s5",
				"#task Sans jeton ^s6",
				"#done 2026-10-19 Fini ^s7",
				"#wait p4 Réponse JMJ ^s8",
			].join("\n"),
		);

		const candidates = sweepCandidates([daily], state(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]), options, TODAY);

		expect(candidates.map((c) => c.id)).toEqual(["s1", "s5", "s8"]);
		expect(candidates[0]).toMatchObject({
			path: "1.meetings/2026-10-20.md",
			title: "Export vide",
			type: "bug",
			priority: 3,
			description: "Le bouton ne fait rien",
			day: "2026-10-20",
		});
	});

	it("leave out a note the sweep age has not passed yet: seven days old is not older than seven days", () => {
		const notes = [note("1.meetings/2026-10-21.md", "#bug p3 Une semaine ^s1"), note("1.meetings/2026-10-20.md", "#bug p3 Plus ^s2")];

		expect(ids(notes, state(["s1", "s2"]))).toEqual(["s2"]);
		expect(ids(notes, state(["s1", "s2"]), { ...options, age: 14 })).toEqual([]);
	});

	it("date a meeting note by its name's prefix, a note without one by its creation time", () => {
		const notes = [
			note("1.meetings/2026-10-13 Réunion JMJ.md", "#bug p3 Vu en réunion ^s1"),
			note("1.meetings/Notes en vrac.md", "#bug p3 Créée tôt ^s2", Date.parse("2026-10-01T12:00:00")),
			note("1.meetings/Notes récentes.md", "#bug p3 Créée hier ^s3"),
		];

		expect(sweepCandidates(notes, state(["s1", "s2", "s3"]), options, TODAY).map((c) => [c.id, c.day])).toEqual([
			["s2", "2026-10-01"],
			["s1", "2026-10-13"],
		]);
	});

	it("read the date in the Daily Notes format", () => {
		const notes = [note("1.meetings/01.10.2026.md", "#bug p3 Format ^s1"), note("1.meetings/01.10.2026 Réunion.md", "#bug p3 Réunion ^s2")];

		expect(sweepCandidates(notes, state(["s1", "s2"]), { ...options, format: "DD.MM.YYYY" }, TODAY).map((c) => c.day)).toEqual([
			"2026-10-01",
			"2026-10-01",
		]);
	});

	it("skip a Task kept until a day still to come, and take it back on that day", () => {
		const notes = [note("1.meetings/2026-10-01.md", "#bug p3 Gardée ^s1\n#bug p3 Plus gardée ^s2\n#bug p3 Jusqu'à aujourd'hui ^s3")];

		expect(ids(notes, state(["s1", "s2", "s3"], { s1: "2026-10-29", s2: "2026-10-20", s3: TODAY }))).toEqual(["s2", "s3"]);
	});

	it("never take Project notes or notes outside the Daily Notes folder, nor lines whose id the app does not hold open", () => {
		const old = Date.parse("2026-09-01T12:00:00");
		const notes = [
			note("2.projects/Widget.md", "#bug p3 Dans un projet ^s1", old),
			note("3.ailleurs/2026-10-01.md", "#bug p3 Ailleurs ^s2"),
			note("1.meetings/2026-10-01.md", "#bug p3 Pas poussée\n#bug p3 Inconnue ^s3\n#bug p3 Archivée ^s4\n#bug p3 Bonne ^s5"),
		];
		const items = [...state(["s1", "s2", "s5"]), { ...state(["s4"])[0]!, archived: true }];

		// A line never Pushed has no id yet: a candidate all the same.
		expect(ids(notes, items, { ...options, isProject: (path) => path === "2.projects/Widget.md" })).toEqual([null, "s5"]);
		expect(ids([note("1.meetings/2026-10-01.md", "#bug p3 Projet ici ^s1")], state(["s1"]), { ...options, isProject: () => true })).toEqual([]);
	});

	it("take the lines not Pushed yet (no ^id), with what the Deck shows of them", () => {
		const notes = [note("1.meetings/2026-10-01.md", "#bug p3 Pas encore poussée\n\tSon corps\n#task p1 Urgente")];

		expect(sweepCandidates(notes, [], options, TODAY)).toEqual([
			{
				id: null,
				path: "1.meetings/2026-10-01.md",
				line: 0,
				raw: "#bug p3 Pas encore poussée",
				title: "Pas encore poussée",
				type: "bug",
				priority: 3,
				description: "Son corps",
				day: "2026-10-01",
			},
		]);
	});

	it("with the Daily Notes folder at the vault's root, take only the notes at the root", () => {
		const notes = [note("2026-10-01.md", "#bug p3 Racine ^s1"), note("1.meetings/2026-10-01.md", "#bug p3 Dossier ^s2")];

		expect(ids(notes, state(["s1", "s2"]), { ...options, folder: "" })).toEqual(["s1"]);
	});
});

describe("The day's first Deck session", () => {
	const now = new Date("2026-10-28T09:00:00");

	it("is the first one when the Deck never wrote, or last wrote on an earlier day", () => {
		expect(firstSessionToday(null, now)).toBe(true);
		expect(firstSessionToday(new Date("2026-10-27T23:30:00").toISOString(), now)).toBe(true);
	});

	it("is not when a Triage, an archive or a keep was written earlier today", () => {
		expect(firstSessionToday(new Date("2026-10-28T00:10:00").toISOString(), now)).toBe(false);
	});
});
