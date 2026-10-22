import { describe, expect, it } from "vitest";
import { InboxStore } from "../src/inbox/inboxStore";
import { placeLine, runTriage, type TriageDeps } from "../src/inbox/triage";
import type { InboxTicket, TaskFields, TriageRequest } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { readProjectSteps, readTagTasks } from "../src/sync/sharedTask";
import { planTaskPush } from "../src/sync/taskPlan";

const ticket = (id = "t7f3a", type: InboxTicket["type"] = "bug"): InboxTicket => ({
	id,
	type,
	title: "Heatmap vide",
	description: "Rien ne s'affiche",
	created_at: "2026-10-20T10:00:00.000Z",
	author_email: "jmj@edf.fr",
	urgency: "genant",
	project_id: null,
});

describe("Inbox À trier", () => {
	it("lists the Tickets to triage first, with their description", async () => {
		const remote = {
			inbox: async () => ({ notifications: [], to_triage: [ticket()] }),
			activity: async () => ({ entries: [], next: null }),
		} as unknown as Remote;
		const store = new InboxStore(remote, () => ({}), () => {});
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
		const store = new InboxStore(remote, () => ({}), () => {});
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

function deps(overrides: Partial<TriageDeps> = {}, description = "Rien ne s'affiche") {
	const sent: [string, TriageRequest][] = [];
	const inserted: string[] = [];
	const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
	let saved = 0;
	const d: TriageDeps = {
		remote: {
			async triage(id, as) {
				sent.push([id, as]);
				const fields: TaskFields = {
					title: "Heatmap vide",
					type: as.type,
					step: as.step,
					status: as.priority === 0 ? "en_cours" : "a_faire",
					priority: as.priority,
					project_id: as.project_id,
					description,
				};
				return { id, as: "task", fields };
			},
		},
		sync,
		save: async () => {
			saved++;
		},
		target: () => ({ path: "2.projects/Widget.md", projectId: "p1abc", step: false }),
		insert: (line) => inserted.push(line),
		...overrides,
	};
	return { d, sent, inserted, sync, saved: () => saved };
}

describe("runTriage (Insérer ici)", () => {
	it("triages in the app, writes the Tag task line with the id, and records it as pushed", async () => {
		const { d, sent, inserted, sync, saved } = deps();
		const result = await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority: 2 }, d);

		expect(result).toEqual({ ok: true, line: "#bug p2 Heatmap vide ^t7f3a", missingImages: 0 });
		expect(sent).toEqual([["t7f3a", { as: "task", type: "bug", step: false, priority: 2, project_id: "p1abc" }]]);
		expect(inserted).toEqual(["#bug p2 Heatmap vide ^t7f3a\n\tRien ne s'affiche"]);
		expect(sync.pushedTasks.t7f3a).toEqual({
			path: "2.projects/Widget.md",
			fields: { title: "Heatmap vide", type: "bug", step: false, status: "a_faire", priority: 2, project_id: "p1abc", description: "Rien ne s'affiche" },
		});
		expect(saved()).toBe(1);
	});

	it("writes the Description under the line, one tab in, blank lines kept empty", async () => {
		const { d, inserted, sync } = deps({}, "Rien ne s'affiche\r\n\r\n  - sur Chrome\n![](/uploads/u1.png)\n\n");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority: 2 }, d);
		expect(inserted).toEqual(["#bug p2 Heatmap vide ^t7f3a\n\tRien ne s'affiche\n\n\t  - sur Chrome\n\t![](/uploads/u1.png)"]);
		expect(sync.pushedTasks.t7f3a!.fields.description).toBe("Rien ne s'affiche\n\n  - sur Chrome\n![](/uploads/u1.png)");
	});

	it("brings the Client's app images into the vault as embeds, and records their app URL", async () => {
		const fetched: string[] = [];
		const { d, inserted, sync } = deps(
			{
				localImage: async (url) => {
					fetched.push(url);
					return { link: "u1.png", path: "Attachments/u1.png", bytes: 42 };
				},
			},
			"Voir :\n![capture](/uploads/u1.png)\n`![](/uploads/u2.png)` reste du code",
		);
		const result = await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority: 2 }, d);

		expect(result).toEqual({ ok: true, line: "#bug p2 Heatmap vide ^t7f3a", missingImages: 0 });
		expect(fetched).toEqual(["/uploads/u1.png"]);
		expect(inserted).toEqual(["#bug p2 Heatmap vide ^t7f3a\n\tVoir :\n\t![[u1.png]]\n\t`![](/uploads/u2.png)` reste du code"]);
		expect(sync.pushedTasks.t7f3a!.fields.description).toBe("Voir :\n![[u1.png]]\n`![](/uploads/u2.png)` reste du code");
		expect(sync.appImages).toEqual({ "Attachments/u1.png": { url: "/uploads/u1.png", bytes: 42 } });
	});

	it("keeps the app link of an image it could not bring in, and says how many", async () => {
		const { d, inserted, sync } = deps({ localImage: async () => null }, "![](/uploads/u1.png)");
		const result = await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority: 2 }, d);
		expect(result).toEqual({ ok: true, line: "#bug p2 Heatmap vide ^t7f3a", missingImages: 1 });
		expect(inserted).toEqual(["#bug p2 Heatmap vide ^t7f3a\n\t![](/uploads/u1.png)"]);
		expect(sync.appImages).toBeUndefined();
	});

	it("writes only the line for an empty Description", async () => {
		const { d, inserted, sync } = deps({}, "");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority: 2 }, d);
		expect(inserted).toEqual(["#bug p2 Heatmap vide ^t7f3a"]);
		expect(sync.pushedTasks.t7f3a!.fields.description).toBe("");
	});

	it("keeps the title on one line", async () => {
		const { d, inserted } = deps({}, "");
		await runTriage({ id: "t7f3a", title: "Heatmap\n  vide " }, { type: "task", priority: 0 }, d);
		expect(inserted).toEqual(["#task p0 Heatmap vide ^t7f3a"]);
	});

	it("does nothing without a note to write in", async () => {
		const { d, sent, inserted } = deps({ target: () => ({ error: "Open the note where the Task goes." }) });
		const result = await runTriage({ id: "t7f3a", title: "X" }, { type: "bug", priority: 2 }, d);
		expect(result).toEqual({ ok: false, error: "Open the note where the Task goes." });
		expect(sent).toEqual([]);
		expect(inserted).toEqual([]);
	});

	it("writes nothing when the app refuses", async () => {
		const { d, inserted, sync } = deps({
			remote: {
				triage: async () => {
					throw new Error("Suivi error (HTTP 409): Pas à trier : t7f3a");
				},
			},
		});
		const result = await runTriage({ id: "t7f3a", title: "X" }, { type: "bug", priority: 2 }, d);
		expect(result).toEqual({ ok: false, error: "Suivi error (HTTP 409): Pas à trier : t7f3a" });
		expect(inserted).toEqual([]);
		expect(sync.pushedTasks).toEqual({});
	});

	it("writes a Project step in a Project note's Tasks section, sent with step: true", async () => {
		const { d, sent, inserted, sync } = deps({ target: () => ({ path: "2.projects/Widget.md", projectId: "p1abc", step: true }) });
		const result = await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority: 2 }, d);
		expect(result).toEqual({ ok: true, line: "- [ ] #bug p2 Heatmap vide ^t7f3a", missingImages: 0 });
		expect(sent).toEqual([["t7f3a", { as: "task", type: "bug", step: true, priority: 2, project_id: "p1abc" }]]);
		expect(inserted).toEqual(["- [ ] #bug p2 Heatmap vide ^t7f3a\n\tRien ne s'affiche"]);
		expect(sync.pushedTasks.t7f3a!.fields).toMatchObject({ step: true, description: "Rien ne s'affiche" });
	});

	it("writes no token for a step that inherits the Project's priority", async () => {
		const { d, sent, inserted } = deps({ target: () => ({ path: "2.projects/Widget.md", projectId: "p1abc", step: true }) }, "");
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "task", priority: null }, d);
		expect(sent).toEqual([["t7f3a", { as: "task", type: "task", step: true, priority: null, project_id: "p1abc" }]]);
		expect(inserted).toEqual(["- [ ] #task Heatmap vide ^t7f3a"]);
	});
});

describe("Triage then Push", () => {
	const description = "Rien ne s'affiche\n\n  - sur Chrome\n![](/uploads/u1.png)\n";
	const links = { "2.projects/Widget.md": { id: "p1abc", title: "Widget" } };

	/** Runs the Triage into `note` at `cursor`, returns the note as written. */
	async function triageInto(note: string[], cursor: number, step: boolean, priority: number | null) {
		let content = note.join("\n");
		const { d, sync } = deps(
			{
				target: () => ({ path: "2.projects/Widget.md", projectId: "p1abc", step }),
				localImage: async () => ({ link: "u1.png", path: "Attachments/u1.png", bytes: 42 }),
				insert: (text) => {
					const at = placeLine(note, cursor, text);
					const lines = [...note];
					lines[cursor] = lines[cursor]!.slice(0, at.from.ch) + at.text + lines[cursor]!.slice(at.to.ch);
					content = lines.join("\n");
				},
			},
			description,
		);
		await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority }, d);
		return { content, sync };
	}

	it("leaves nothing to push for a Tag task", async () => {
		const { content, sync } = await triageInto(["# Réunion", "", "Suite"], 0, false, 2);
		const local = readTagTasks("2.projects/Widget.md", content, "2.projects/Widget.md");
		expect(local).toHaveLength(1);
		expect(planTaskPush(local, links, sync.pushedTasks, { now: new Date() }).changes).toEqual([]);
	});

	it("leaves nothing to push for a step that inherits", async () => {
		const { content, sync } = await triageInto(["## Tasks", "- [ ] Étape ^s1", "## Notes"], 1, true, null);
		const local = readProjectSteps("2.projects/Widget.md", content).filter((t) => t.blockId === "t7f3a");
		expect(local).toHaveLength(1);
		expect(planTaskPush(local, links, sync.pushedTasks, { now: new Date() }).changes).toEqual([]);
	});
});
