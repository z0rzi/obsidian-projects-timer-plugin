import { describe, expect, it } from "vitest";
import { InboxStore } from "../src/inbox/inboxStore";
import { placeLine, runTriage, type TriageChoice, type TriageDeps } from "../src/inbox/triage";
import type { InboxTicket, TaskFields, TriageRequest } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import { fakeLinks } from "./fakeSuivi";

const ticket = (id = "t7f3a", type: InboxTicket["type"] = "bug"): InboxTicket => ({
	id,
	type,
	title: "Heatmap vide",
	description: "Rien ne s'affiche",
	created_at: "2026-10-20T10:00:00.000Z",
	author_email: "jmj@edf.fr",
	urgency: "genant",
	requested_priority: null,
	project_id: null,
	zone_id: null,
});

describe("Inbox À trier", () => {
	it("lists the Tickets to triage first, with their description", async () => {
		const remote = {
			inbox: async () => ({ notifications: [], to_triage: [ticket()] }),
			activity: async () => ({ entries: [], next: null }),
		} as unknown as Remote;
		const store = new InboxStore(remote, () => {});
		await store.refresh();

		expect(store.current.toTriage).toEqual([
			expect.objectContaining({
				kind: "ticket",
				ticketType: "bug",
				title: "Bug: Heatmap vide",
				detail: "Rien ne s'affiche",
				by: "jmj@edf.fr",
				item: { kind: "task", id: "t7f3a", title: "Heatmap vide" },
			}),
		]);
	});

	it("copes with an app answer without to_triage", async () => {
		const remote = {
			inbox: async () => ({ notifications: [] }),
			activity: async () => ({ entries: [], next: null }),
		} as unknown as Remote;
		const store = new InboxStore(remote, () => {});
		await store.refresh();
		expect(store.current.toTriage).toEqual([]);
	});
});

describe("placeLine", () => {
	it("writes on the cursor's line when it is blank", () => {
		expect(placeLine(["a", "", ""], 1, "#bug p2 X ^t7f3a")).toEqual({
			from: { line: 1, ch: 0 },
			to: { line: 1, ch: 0 },
			text: "#bug p2 X ^t7f3a",
		});
	});

	it("goes below a non-blank line", () => {
		expect(placeLine(["#task p1 Y", ""], 0, "#bug p2 X ^t7f3a")).toEqual({
			from: { line: 0, ch: 10 },
			to: { line: 0, ch: 10 },
			text: "\n#bug p2 X ^t7f3a",
		});
	});

	it("keeps a blank line before following text, so it doesn't become the Task's body", () => {
		expect(placeLine(["intro", "suite"], 0, "#bug p2 X").text).toBe("\n#bug p2 X\n");
		expect(placeLine(["", "suite"], 0, "#bug p2 X").text).toBe("#bug p2 X\n");
	});

	it("keeps that blank line after the body too", () => {
		expect(placeLine(["intro", "suite"], 0, "#bug p2 X\n\tcorps").text).toBe("\n#bug p2 X\n\tcorps\n");
	});
});


const today = "1.meetings/2026-10-27.md";
const widget = "2.projects/Widget.md";

/**
 * Triage's deps over notes by path (`notes`, edited in place): today's Daily
 * note is `today`, Project notes sit in `2.projects/`, links resolve by name.
 */
function deps(notes: Map<string, string>, overrides: Partial<TriageDeps> = {}, description = "Rien ne s'affiche") {
	const sent: [string, TriageRequest][] = [];
	/** Bases the app was sent, by id. */
	const bases: Record<string, { path: string; fields: TaskFields }> = {};
	const d: TriageDeps = {
		remote: {
			async triage(id, as) {
				sent.push([id, as]);
				if (as.as === "project") throw new Error("not a Task");
				const fields: TaskFields = {
					title: "Heatmap vide",
					type: as.type,
					step: false,
					priority: as.priority,
					done: false,
					project_id: as.project_id,
					description,
				};
				return { id, as: "task", fields };
			},
			async acknowledge(items) {
				for (const i of items) bases[i.id] = i.base as (typeof bases)[string];
			},
		},
		dailyNote: today,
		heading: "## Triage",
		template: async () => "",
		async write(path, edit) {
			const content = edit(notes.get(path) ?? null);
			notes.set(path, content);
			return content;
		},
		linkText(path) {
			const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
			const same = [...notes.keys()].filter((p) => p.endsWith(`/${name}.md`) || p === `${name}.md`);
			return same.length > 1 ? path.replace(/\.md$/, "") : name;
		},
		projects: { links: fakeLinks(() => [...notes.keys()]), isProject: (p) => p.startsWith("2.projects/") },
		appUrl: "https://suivi.test/",
		...overrides,
	};
	return { d, sent, bases };
}

const bug = (more: Partial<TriageChoice> = {}): TriageChoice => ({ type: "bug", priority: 2, project: null, ...more });

describe("runTriage into today's Daily note", () => {
	it("triages in the app with type, Priority, Project and Zone, never step", async () => {
		const notes = new Map([[widget, "---\nsuivi_id: p1abc\n---\n# Widget"]]);
		const { d, sent } = deps(notes);
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug({ project: { path: widget, id: "p1abc" }, zone: 4 }), d);
		expect(sent).toEqual([["t7f3a", { as: "task", type: "bug", priority: 2, project_id: "p1abc", zone_id: 4 }]]);
	});

	it("sends the Ticket's changed_at as `expected`, so the app refuses one edited meanwhile", async () => {
		const { d, sent } = deps(new Map());
		await runTriage({ id: "t1", title: "A", changed_at: "2026-10-20T10:00:00.000Z" }, bug(), d);
		expect(sent.map(([, as]) => as)).toEqual([
			{ as: "task", type: "bug", priority: 2, project_id: null, expected: "2026-10-20T10:00:00.000Z" },
		]);
	});

	it("sends no zone_id when the Zone is left as the Client put it, null for none", async () => {
		const { d, sent } = deps(new Map());
		await runTriage({ id: "t1", title: "A" }, bug(), d);
		await runTriage({ id: "t2", title: "B" }, bug({ zone: null }), d);
		expect(sent.map(([, as]) => as)).toEqual([
			{ as: "task", type: "bug", priority: 2, project_id: null },
			{ as: "task", type: "bug", priority: 2, project_id: null, zone_id: null },
		]);
	});

	it("appends the line and its body at the end of the Triage section", async () => {
		const notes = new Map([[today, "# Mardi\n\n## Triage\n#task p3 Avant ^t0aaa\n\tson corps\n\n## Notes\nrien\n"]]);
		const { d } = deps(notes);
		const result = await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d);
		expect(result).toEqual({ ok: true, line: "#bug p2 Heatmap vide ^t7f3a", path: today, missingImages: 0 });
		expect(notes.get(today)).toBe(
			"# Mardi\n\n## Triage\n#task p3 Avant ^t0aaa\n\tson corps\n#bug p2 Heatmap vide ^t7f3a\n\tRien ne s'affiche\n\n## Notes\nrien\n",
		);
	});

	it("ends a section that runs to the end of the note, and a deeper heading stays inside it", async () => {
		const notes = new Map([[today, "## Triage\n### Matin\n#task p3 Avant ^t0aaa\n"]]);
		const { d } = deps(notes, {}, "");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d);
		expect(notes.get(today)).toBe("## Triage\n### Matin\n#task p3 Avant ^t0aaa\n#bug p2 Heatmap vide ^t7f3a\n");
	});

	it("writes right under a heading with nothing in its section", async () => {
		const notes = new Map([[today, "## Triage\n\n## Notes"]]);
		const { d } = deps(notes, {}, "");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d);
		expect(notes.get(today)).toBe("## Triage\n#bug p2 Heatmap vide ^t7f3a\n\n## Notes");
	});

	it("appends the heading at the end of a note without it", async () => {
		const notes = new Map([[today, "# Mardi\nréunion\n\n"]]);
		const { d } = deps(notes, { heading: "## À faire" }, "");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d);
		expect(notes.get(today)).toBe("# Mardi\nréunion\n\n## À faire\n#bug p2 Heatmap vide ^t7f3a\n");
	});

	it("creates a missing note from the template, its {{date}} and {{title}} filled", async () => {
		const notes = new Map<string, string>();
		const { d } = deps(notes, { template: async () => "---\ntags: daily\n---\n# {{title}}\nDate : {{date}}\n" }, "");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d);
		expect(notes.get(today)).toBe("---\ntags: daily\n---\n# 2026-10-27\nDate : 2026-10-27\n\n## Triage\n#bug p2 Heatmap vide ^t7f3a\n");
	});

	it("creates a missing note with only the heading and the line without a template", async () => {
		const notes = new Map<string, string>();
		const { d } = deps(notes, {}, "");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d);
		expect(notes.get(today)).toBe("## Triage\n#bug p2 Heatmap vide ^t7f3a\n");
	});

	it("leaves the meeting notes of the day alone", async () => {
		const meeting = "1.meetings/2026-10-27 Réunion EDF.md";
		const notes = new Map([[meeting, "## Triage\n"]]);
		const { d } = deps(notes, {}, "");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d);
		expect(notes.get(meeting)).toBe("## Triage\n");
		expect(notes.get(today)).toBe("## Triage\n#bug p2 Heatmap vide ^t7f3a\n");
	});

	it("writes the Project as the body's first line, a link by the note's name", async () => {
		const notes = new Map([[widget, "---\nsuivi_id: p1abc\n---\n# Widget"]]);
		const { d, bases } = deps(notes);
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug({ project: { path: widget, id: "p1abc" } }), d);
		expect(notes.get(today)).toBe("## Triage\n#bug p2 Heatmap vide ^t7f3a\n\t[[Widget]]\n\tRien ne s'affiche\n");
		expect(bases.t7f3a).toEqual({
			path: today,
			fields: { title: "Heatmap vide", type: "bug", step: false, priority: 2, done: false, project_id: "p1abc", description: "Rien ne s'affiche" },
		});
	});

	it("links by path when another note has the Project's name", async () => {
		const notes = new Map([
			[widget, "# Widget"],
			["3.archive/Widget.md", "# Ancien"],
		]);
		const { d, bases } = deps(notes, {}, "");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug({ project: { path: widget, id: null } }), d);
		expect(notes.get(today)).toBe("## Triage\n#bug p2 Heatmap vide ^t7f3a\n\t[[2.projects/Widget]]\n");
		expect(bases.t7f3a!.fields).toMatchObject({ project_id: null, description: "" });
	});

	it("writes a Rapide without token and a Frigo line with pz", async () => {
		const notes = new Map<string, string>();
		const { d, sent } = deps(notes, {}, "");
		await runTriage({ id: "t1abc", title: "Marge" }, { type: "quick", priority: "pq", project: null }, d);
		await runTriage({ id: "t2abc", title: "Plus tard" }, { type: "task", priority: "pz", project: null }, d);
		expect(sent.map(([, as]) => (as.as === "task" ? as.priority : null))).toEqual(["pq", "pz"]);
		expect(notes.get(today)).toBe("## Triage\n#quick Marge ^t1abc\n#task pz Plus tard ^t2abc\n");
	});

	it("writes the Description one tab in, blank lines kept empty, and sends it as the vault reads it", async () => {
		const notes = new Map<string, string>();
		const { d, bases } = deps(notes, {}, "Rien ne s'affiche\r\n\r\n  - sur Chrome\n![](/uploads/u1.png)\n\n");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d);
		expect(notes.get(today)).toBe("## Triage\n#bug p2 Heatmap vide ^t7f3a\n\tRien ne s'affiche\n\n\t  - sur Chrome\n\t![](https://suivi.test/uploads/u1.png)\n");
		expect(bases.t7f3a!.fields.description).toBe("Rien ne s'affiche\n\n  - sur Chrome\n![](https://suivi.test/uploads/u1.png)");
	});

	it("brings the Client's app images into the vault as embeds", async () => {
		const fetched: string[] = [];
		const notes = new Map<string, string>();
		const localImage = async (url: string) => {
			fetched.push(url);
			return "u1.png";
		};
		const { d, bases } = deps(notes, { localImage }, "Voir :\n![capture](/uploads/u1.png)\n`![](/uploads/u2.png)` reste du code");
		const result = await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d);
		expect(result).toMatchObject({ ok: true, missingImages: 0 });
		expect(fetched).toEqual(["/uploads/u1.png"]);
		expect(bases.t7f3a!.fields.description).toBe("Voir :\n![[u1.png]]\n`![](/uploads/u2.png)` reste du code");
	});

	it("keeps the app link of an image it could not bring in, made absolute, and says how many", async () => {
		const notes = new Map<string, string>();
		const { d } = deps(notes, { localImage: async () => null }, "![](/uploads/u1.png)");
		expect(await runTriage({ id: "t7f3a", title: "Heatmap vide" }, bug(), d)).toMatchObject({ ok: true, missingImages: 1 });
		expect(notes.get(today)).toBe("## Triage\n#bug p2 Heatmap vide ^t7f3a\n\t![](https://suivi.test/uploads/u1.png)\n");
	});

	it("keeps the title on one line", async () => {
		const notes = new Map<string, string>();
		const { d } = deps(notes, {}, "");
		await runTriage({ id: "t7f3a", title: "Heatmap\n  vide " }, { type: "task", priority: 0, project: null }, d);
		expect(notes.get(today)).toBe("## Triage\n#task p0 Heatmap vide ^t7f3a\n");
	});

	it("writes nothing when the app refuses", async () => {
		const notes = new Map<string, string>();
		const { d, bases } = deps(notes);
		d.remote.triage = async () => {
			throw new Error("Suivi error (HTTP 409): Pas à trier : t7f3a");
		};
		const result = await runTriage({ id: "t7f3a", title: "X" }, bug(), d);
		expect(result).toEqual({ ok: false, error: "Suivi error (HTTP 409): Pas à trier : t7f3a" });
		expect(notes.size).toBe(0);
		expect(bases).toEqual({});
	});

	it("reports no success and sends no base when the note could not be written", async () => {
		const { d, bases } = deps(new Map(), { write: async () => Promise.reject(new Error("disque plein")) });
		const result = await runTriage({ id: "t7f3a", title: "X" }, bug(), d);
		expect(result).toEqual({ ok: false, triaged: true, error: expect.stringContaining("triée dans l'app, mais pas écrite (disque plein)") });
		expect(bases).toEqual({});
	});

	it("says so when the line is written but the app didn't take its base", async () => {
		const notes = new Map<string, string>();
		const { d } = deps(notes);
		d.remote.acknowledge = async () => {
			throw new Error("Suivi unreachable");
		};
		const result = await runTriage({ id: "t7f3a", title: "X" }, bug(), d);
		expect(result).toEqual({ ok: false, triaged: true, error: expect.stringContaining("insérée, mais sa base n'a pas été envoyée (Suivi unreachable)") });
		expect(notes.get(today)).toContain("^t7f3a");
	});
});
