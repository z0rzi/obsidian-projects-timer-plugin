import { describe, expect, it } from "vitest";
import { runTriage, type TriageDeps } from "../src/inbox/triage";
import { PluginData } from "../src/sync/pluginData";
import { appProject, appTask, fakeLinks, pushWorld as world } from "./fakeSuivi";
import { localDay } from "../src/localDate";

const widget = "2.projects/Widget.md";

/** Triage's deps over the world's notes: today's Daily note is `1.meetings/2026-10-20.md`, links by name. */
function triageDeps(w: ReturnType<typeof world>): TriageDeps {
	return {
		remote: w.app.remote,
		dailyNote: "1.meetings/2026-10-20.md",
		heading: "## Triage",
		template: async () => "",
		async write(path, edit) {
			const content = edit(w.files.get(path) ?? null);
			w.files.set(path, content);
			return content;
		},
		linkText: (path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
		projects: { links: fakeLinks(() => [...w.files.keys()]), isProject: (p) => p.startsWith("2.projects/") },
		appUrl: "https://suivi.test",
		localImage: async () => "u1.png",
	};
}

describe("Push planned against the app's state", () => {
	it("creates the Items of a vault with ids in an empty app, keeping their ids", async () => {
		const w = world({
			[widget]: "---\nsuivi_id: p0002\npriority: 2\n---\n# Tasks\n- [ ] #bug p1 Export ^s9xyz\n",
			"m.md": "#task p3 Heatmap ^t7f3a\n",
		});

		const pending = await w.plan();
		expect(pending.map((c) => [c.group, "id" in c ? c.id : undefined])).toEqual([
			["new", "p0002"],
			["new", "t7f3a"],
			["new", "s9xyz"],
		]);
		expect(await w.push(pending)).toEqual({ applied: 3, failed: [] });
		expect(w.app.received.flat().map((c) => [c.op, c.kind, "id" in c ? c.id : undefined])).toEqual([
			["create", "project", "p0002"],
			["create", "task", "t7f3a"],
			["create", "task", "s9xyz"],
		]);
		expect(await w.plan()).toEqual([]);
	});

	it("writes a generated id into the note before creating with it", async () => {
		const w = world({ [widget]: "---\npriority: 2\n---\n# Tasks\n- [ ] Export\n", "m.md": "#task p3 Heatmap\n" });

		expect(await w.push()).toEqual({ applied: 3, failed: [] });

		const projectId = w.files.get(widget)!.match(/suivi_id: ([a-z0-9]{5})\n/)![1];
		const stepId = w.files.get(widget)!.match(/Export \^([a-z0-9]{5})$/m)![1];
		const taskId = w.files.get("m.md")!.match(/Heatmap \^([a-z0-9]{5})$/m)![1];
		expect(w.app.received.flat()).toMatchObject([
			{ op: "create", kind: "project", id: projectId },
			{ op: "create", kind: "task", id: taskId },
			{ op: "create", kind: "task", id: stepId, fields: { project_id: projectId } },
		]);
		expect(await w.plan()).toEqual([]);
	});

	it("sends each change with its base and the app values it expects", async () => {
		const base = { path: "m.md", fields: { title: "Heatmap", type: "task", step: false, priority: 3, done: false, project_id: null, description: "" } };
		const w = world({ "m.md": "#task p2 Heatmap ^t7f3a\n" }, [appTask("t7f3a", { title: "Heatmap", priority: 3 }, { base })]);

		await w.push();

		expect(w.app.received).toEqual([
			[
				{
					op: "update",
					kind: "task",
					id: "t7f3a",
					fields: { priority: 2 },
					expected: { priority: 3 },
					base: { path: "m.md", fields: { ...base.fields, priority: 2 } },
				},
			],
		]);
	});

	it("reports a change the app refused because the Client changed it meanwhile", async () => {
		const base = { path: "m.md", fields: { title: "Heatmap", type: "task", step: false, priority: 3, done: false, project_id: null, description: "" } };
		const w = world({ "m.md": "#task p2 Heatmap ^t7f3a\n" }, [appTask("t7f3a", { title: "Heatmap", priority: 3 }, { base })]);
		const pending = await w.plan();
		w.app.held.get("t7f3a")!.fields.priority = 1;

		const outcome = await w.push(pending);

		expect(outcome).toEqual({ applied: 0, failed: [{ title: "Heatmap", error: expect.stringContaining("priority") }] });
	});

	it("lists an archived id as Restaurer and unarchives it", async () => {
		const w = world({ "m.md": "#task p2 Heatmap ^t7f3a\n" }, [appTask("t7f3a", { title: "Heatmap" }, { archived: true })]);

		const pending = await w.plan();
		expect(pending).toMatchObject([{ group: "restored", id: "t7f3a", change: { op: "restore", kind: "task", id: "t7f3a" } }]);
		await w.push(pending);

		expect(w.app.held.get("t7f3a")!.archived).toBe(false);
		expect(await w.plan()).toEqual([]);
	});

	it("refuses an id the app holds as the other kind", async () => {
		const w = world({ [widget]: "---\nsuivi_id: t7f3a\n---\n" }, [appTask("t7f3a", { title: "Heatmap" })]);

		expect(await w.plan()).toMatchObject([{ group: "error", title: "Widget", error: expect.stringContaining("Task") }]);
	});

	it("does not push a line whose block id is not in the app's format", async () => {
		const w = world({ "m.md": "#task p2 Heatmap ^abc123\n" });

		expect(await w.plan()).toMatchObject([{ group: "error", title: "Heatmap", error: "id de bloc non reconnu" }]);
	});

	describe("a Task linked to a Done Project never sent", () => {
		const livre = "2.projects/Livré.md";
		const done = "---\narchived: true\n---\n# Tasks\n- [ ] Export\n";
		const base = { path: "m.md", fields: { title: "Heatmap", type: "task", step: false, priority: 3, done: false, project_id: null, description: "" } };
		const refused = (path: string, title: string) => ({
			group: "error",
			key: expect.stringMatching(new RegExp(`^error:${path}:\\d+$`)),
			path,
			title,
			error: "lié à un projet archivé jamais envoyé : Livré",
		});

		it("is refused on its line, by its line's link or its body's first line, and nothing is sent", async () => {
			const w = world(
				{ [livre]: done, "m.md": "#task p2 Heatmap v2 [[Livré]] ^t7f3a\n#bug p1 Export\n  [[Livré]]\n" },
				[appTask("t7f3a", { title: "Heatmap", priority: 3 }, { base })],
			);

			const pending = await w.plan();
			expect(pending).toEqual([refused("m.md", "Heatmap v2 [[Livré]]"), refused("m.md", "Export")]);
			expect(await w.push(pending)).toEqual({ applied: 0, failed: [] });
			expect(w.app.received.flat()).toEqual([]);
			expect(w.app.held.get("t7f3a")!.fields).toMatchObject({ title: "Heatmap", priority: 3 });
		});

		it("is refused when its note names that Project, or is that Project note; the note's steps stay out", async () => {
			const w = world({
				[livre]: "---\narchived: true\n---\n#task p2 Heatmap\n# Tasks\n- [ ] Export\n",
				"m.md": "---\nproject: \"[[Livré]]\"\n---\n#task p2 Legend\n",
			});

			expect(await w.plan()).toEqual([refused(livre, "Heatmap"), refused("m.md", "Legend")]);
		});

		it("is pushed once the link is gone", async () => {
			const w = world({ [livre]: done, "m.md": "#task p2 Heatmap v2 [[Livré]] ^t7f3a\n" }, [appTask("t7f3a", { title: "Heatmap", priority: 3 }, { base })]);
			w.files.set("m.md", "#task p2 Heatmap v2 ^t7f3a\n");

			await w.push();

			expect(w.app.held.get("t7f3a")!.fields).toMatchObject({ title: "Heatmap v2", priority: 2 });
			expect(await w.plan()).toEqual([]);
		});

		it("is pushed with its Project once that Project is un-archived", async () => {
			const w = world({ [livre]: done, "m.md": "#task p2 Heatmap v2 [[Livré]] ^t7f3a\n" }, [appTask("t7f3a", { title: "Heatmap", priority: 3 }, { base })]);
			w.files.set(livre, "---\npriority: 2\n---\n# Tasks\n- [ ] Export\n");

			await w.push();

			const projectId = w.files.get(livre)!.match(/suivi_id: ([a-z0-9]{5})\n/)![1];
			expect(w.app.held.get("t7f3a")!.fields).toMatchObject({ title: "Heatmap v2 [[Livré]]", priority: 2, project_id: projectId });
			expect(await w.plan()).toEqual([]);
		});

		it("unlike one linked to a private Project, left out silently, or to a Done Project the app holds, pushed", async () => {
			const w = world(
				{
					"2.projects/Secret.md": "---\nprive: true\n---\n",
					[widget]: "---\nsuivi_id: p0002\narchived: true\n---\n",
					"m.md": "#task p2 Heatmap [[Secret]]\n#task p2 Legend [[Widget]]\n",
				},
				[appProject("p0002", { title: "Widget", done: true, priority: null })],
			);

			expect(await w.plan()).toMatchObject([{ group: "new", title: "Legend [[Widget]]", fields: { project_id: "p0002" } }]);
		});
	});

	it("never offers an app Item that no note carries", async () => {
		const w = world({ "m.md": "" }, [appTask("t7f3a", { title: "Heatmap" }), appProject("p0002", { title: "Widget" })]);

		expect(await w.plan()).toEqual([]);
	});

	it("lists undated done lines unticked at a first Push, ticked afterwards, and dates them when pushed", async () => {
		const notes = { "m.md": "#done Vieille tâche\n" };
		const first = world(notes);
		expect(await first.plan()).toMatchObject([{ group: "new", undated: true, ticked: false }]);

		const base = { path: "m.md", fields: { title: "Autre", type: "task", step: false, priority: 1, done: false, project_id: null, description: "" } };
		const later = world({ "m.md": "#done Vieille tâche\n#task Autre ^t7f3a\n" }, [appTask("t7f3a", base.fields, { base })]);
		const pending = await later.plan();
		expect(pending).toMatchObject([{ group: "new", undated: true, ticked: true }]);
		await later.push(pending);

		const today = localDay();
		expect(later.files.get("m.md")).toMatch(new RegExp(`^#done ${today} Vieille tâche \\^[a-z0-9]{5}\\n#task Autre \\^t7f3a\\n$`));
		expect(later.app.received.flat()).toMatchObject([{ op: "create", fields: { done: true, done_on: today } }]);
		expect(await later.plan()).toEqual([]);
	});

	it("pushes a body with a wikilink and an image, then finds nothing to push", async () => {
		const w = world({ "m.md": "#task p2 Heatmap\n\tVoir [[Widget]] et ![[capture.png]]\n" });

		expect(await w.push()).toEqual({ applied: 1, failed: [] });

		expect(w.app.received.flat()).toMatchObject([{ fields: { description: "Voir Widget et ![](/uploads/u0.png)" } }]);
		expect(await w.plan()).toEqual([]);
	});

	it("triages a Ticket with an image and a PDF into today's Daily note, then finds nothing to push", async () => {
		const description = "Voir ![](/uploads/u1.png) [doc.pdf](/uploads/d.pdf)";
		const ticket = appTask("t7f3a", { title: "Heatmap vide", type: "bug", priority: null, done: false, description }, { triaged: false });
		const w = world({ "1.meetings/2026-10-20.md": "" }, [ticket]);

		const result = await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority: 2, project: null }, triageDeps(w));

		expect(result).toMatchObject({ ok: true });
		expect(w.files.get("1.meetings/2026-10-20.md")).toBe(
			"## Triage\n#bug p2 Heatmap vide ^t7f3a\n\tVoir ![[u1.png]] [doc.pdf](https://suivi.test/uploads/d.pdf)\n",
		);
		expect(await w.plan()).toEqual([]);
	});

	it("triages a Ticket into a Project by a body link, then finds nothing to push; the meeting note stays as it was", async () => {
		const ticket = appTask("t7f3a", { title: "Heatmap vide", type: "bug", priority: null, done: false, description: "Rien ne s'affiche" }, { triaged: false });
		const project = appProject("p0002", { title: "Widget", priority: 2, done: false }, { base: { path: widget, fields: { title: "Widget", description: "", priority: 2, done: false, due_date: null } } });
		const meeting = "1.meetings/2026-10-20 Réunion.md";
		const w = world({ [widget]: "---\nsuivi_id: p0002\npriority: 2\n---\n", [meeting]: "## Triage\n", "1.meetings/2026-10-20.md": "# Lundi\n" }, [ticket, project]);
		expect(await w.plan()).toEqual([]);

		const choice = { type: "bug" as const, priority: "pz" as const, project: { path: widget, id: "p0002" }, zone: 3 };
		expect(await runTriage({ id: "t7f3a", title: "Heatmap vide" }, choice, triageDeps(w))).toMatchObject({ ok: true });

		expect(w.files.get("1.meetings/2026-10-20.md")).toBe("# Lundi\n\n## Triage\n#bug pz Heatmap vide ^t7f3a\n\t[[Widget]]\n\tRien ne s'affiche\n");
		expect(w.files.get(meeting)).toBe("## Triage\n");
		expect(w.app.held.get("t7f3a")!.fields).toMatchObject({ project_id: "p0002", priority: "pz", zone_id: 3 });
		expect(await w.plan()).toEqual([]);
	});

	it("drops a foreign appImages from data.json: images go through the upload endpoint", async () => {
		const disk = { sync: { pushedProjects: {}, pushedTasks: {}, appImages: { "capture.png": { url: "/uploads/foreign.png", bytes: 11 } } } };
		const saved: unknown[] = [];
		const data = await PluginData.load({}, async () => disk, async (d) => void saved.push(d));
		await data.save();
		expect(saved).toEqual([{}]);

		const w = world({ "m.md": "#task p2 Heatmap\n\t![[capture.png]]\n" });
		await w.push();

		expect(JSON.stringify(w.app.received)).not.toContain("foreign");
		expect(w.app.received.flat()).toMatchObject([{ fields: { description: "![](/uploads/u0.png)" } }]);
	});
});
