import { describe, expect, it } from "vitest";
import { runTriage } from "../src/inbox/triage";
import { PluginData } from "../src/sync/pluginData";
import { appProject, appTask, pushWorld as world } from "./fakeSuivi";
import { localDay } from "../src/localDate";

const widget = "2.projects/Widget.md";

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
		const base = { path: "m.md", fields: { title: "Heatmap", type: "task", step: false, status: "a_faire", priority: 3, project_id: null, description: "" } };
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
		const base = { path: "m.md", fields: { title: "Heatmap", type: "task", step: false, status: "a_faire", priority: 3, project_id: null, description: "" } };
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

	it("never offers an app Item that no note carries", async () => {
		const w = world({ "m.md": "" }, [appTask("t7f3a", { title: "Heatmap" }), appProject("p0002", { title: "Widget" })]);

		expect(await w.plan()).toEqual([]);
	});

	it("lists undated done lines unticked at a first Push, ticked afterwards, and dates them when pushed", async () => {
		const notes = { "m.md": "#done Vieille tâche\n" };
		const first = world(notes);
		expect(await first.plan()).toMatchObject([{ group: "new", undated: true, ticked: false }]);

		const base = { path: "x.md", fields: {} };
		const later = world(notes, [appTask("t7f3a", { title: "Autre" }, { base })]);
		const pending = await later.plan();
		expect(pending).toMatchObject([{ group: "new", undated: true, ticked: true }]);
		await later.push(pending);

		const today = localDay();
		expect(later.files.get("m.md")).toMatch(new RegExp(`^#done ${today} Vieille tâche \\^[a-z0-9]{5}\\n$`));
		expect(later.app.received.flat()).toMatchObject([{ op: "create", fields: { status: "termine", done_on: today } }]);
		expect(await later.plan()).toEqual([]);
	});

	it("pushes a body with a wikilink and an image, then finds nothing to push", async () => {
		const w = world({ "m.md": "#task p2 Heatmap\n\tVoir [[Widget]] et ![[capture.png]]\n" });

		expect(await w.push()).toEqual({ applied: 1, failed: [] });

		expect(w.app.received.flat()).toMatchObject([{ fields: { description: "Voir Widget et ![](/uploads/u0.png)" } }]);
		expect(await w.plan()).toEqual([]);
	});

	it("triages a Ticket with an image, then finds nothing to push", async () => {
		const ticket = appTask("t7f3a", { title: "Heatmap vide", type: "bug", status: "a_trier", priority: null, description: "Voir ![](/uploads/u1.png)" }, { triaged: false });
		const w = world({ "m.md": "" }, [ticket]);

		const result = await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority: 2 }, {
			remote: w.app.remote,
			target: () => ({ path: "m.md", projectId: null, step: false }),
			insert: (text) => w.files.set("m.md", `${text}\n`),
			localImage: async () => "u1.png",
		});

		expect(result).toMatchObject({ ok: true });
		expect(w.files.get("m.md")).toBe("#bug p2 Heatmap vide ^t7f3a\n\tVoir ![[u1.png]]\n");
		expect(await w.plan()).toEqual([]);
	});

	it("drops a foreign appImages from data.json: images go through the upload endpoint", async () => {
		const disk = { sync: { pushedProjects: {}, pushedTasks: {}, appImages: { "capture.png": { url: "/uploads/foreign.png", bytes: 11 } } } };
		const data = await PluginData.load({}, async () => disk, async () => {});
		expect("appImages" in data.sync).toBe(false);

		const w = world({ "m.md": "#task p2 Heatmap\n\t![[capture.png]]\n" });
		await w.push();

		expect(JSON.stringify(w.app.received)).not.toContain("foreign");
		expect(w.app.received.flat()).toMatchObject([{ fields: { description: "![](/uploads/u0.png)" } }]);
	});
});
