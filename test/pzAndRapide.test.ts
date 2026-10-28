import { describe, expect, it } from "vitest";
import type { ItemState, TaskFields } from "../src/remote/api";
import { frigoCount } from "../src/sync/appState";
import { appProject, appTask, pushWorld } from "./fakeSuivi";

const meeting = "1.meetings/2026-10-13.md";
const widget = "2.projects/Widget.md";
const heatmap: TaskFields = { title: "Heatmap", type: "task", step: false, priority: 3, done: false, project_id: null, description: "" };

describe("A state carrying a Priority the plugin does not know", () => {
	const world = () =>
		pushWorld({ [meeting]: "#task p3 Heatmap ^t7f3a\n" }, [
			appTask("t7f3a", { ...heatmap, priority: "px" as never }, { base: { path: meeting, fields: heatmap }, priority_by: "jmj" }) as ItemState,
		]);

	it("is refused by the Pull, which writes nothing, with a notice to update the plugin", async () => {
		const w = world();
		await expect(w.pull()).rejects.toThrow(/update the plugin/);
		expect(w.files.get(meeting)).toBe("#task p3 Heatmap ^t7f3a\n");
	});

	it("is refused by the Push plan the same way", async () => {
		await expect(world().plan()).rejects.toThrow(/update the plugin/);
	});
});

describe("PZ by Push and Pull", () => {
	it("pushes a pz line and a priority: pz Project, then has nothing left to push", async () => {
		const w = pushWorld({
			[widget]: "---\nsuivi_id: p0002\npriority: pz\n---\n# Tasks\n- [ ] Devis ^s1xyz\n",
			[meeting]: "#bug pz Plantage rare ^t7f3a\n",
		});
		const pending = await w.plan();
		expect(pending).toMatchObject([
			{ group: "new", id: "p0002", fields: { priority: "pz" } },
			{ group: "new", id: "t7f3a", fields: { priority: "pz" }, detail: "Bug · Au frigo" },
			{ group: "new", id: "s1xyz", fields: { priority: null } },
		]);
		expect(await w.push(pending)).toEqual({ applied: 3, failed: [] });
		expect(await w.plan()).toEqual([]);
	});

	it("shows « Au frigo » in the review of a line sent to PZ", async () => {
		const w = pushWorld({ [meeting]: "#task pz Heatmap ^t7f3a\n" }, [appTask("t7f3a", heatmap, { base: { path: meeting, fields: heatmap } })]);
		expect(await w.plan()).toMatchObject([{ group: "changed", diffs: [{ field: "priority", from: "P3", to: "Au frigo" }] }]);
	});

	it("writes pz pulled from the app on a line and in a Project's frontmatter", async () => {
		const project = { title: "Widget", description: "", priority: 3 as const, done: false, due_date: null };
		const w = pushWorld(
			{ [widget]: "---\nsuivi_id: p0002\npriority: 3\n---\n", [meeting]: "#task p3 Heatmap ^t7f3a\n" },
			[
				appProject("p0002", { ...project, priority: "pz" }, { base: { path: widget, fields: project }, priority_by: "jmj" }),
				appTask("t7f3a", { ...heatmap, priority: "pz" }, { base: { path: meeting, fields: heatmap }, priority_by: "jmj" }),
			],
		);
		expect((await w.pull()).applied).toBe(2);
		expect(w.files.get(meeting)).toBe("#task pz Heatmap ^t7f3a\n");
		expect(w.files.get(widget)).toContain("priority: pz");
		expect(await w.plan()).toEqual([]);
	});
});

describe("Rapides by Push and Pull", () => {
	const rapide: TaskFields = { title: "Renommer", type: "quick", step: false, priority: "pz", done: false, project_id: null, description: "" };

	it("pushes a #quick line without token as Rapide", async () => {
		const w = pushWorld({ [meeting]: "#quick Renommer ^t2abc\n" });
		expect(await w.plan()).toMatchObject([{ group: "new", fields: { type: "quick", priority: "pq" }, detail: "Tâche rapide · Rapide" }]);
		expect(await w.push()).toEqual({ applied: 1, failed: [] });
		expect(w.app.held.get("t2abc")!.fields.priority).toBe("pq");
		expect(await w.plan()).toEqual([]);
	});

	it("refuses a #quick line with a rank in the review, with its line, until it is edited", async () => {
		const w = pushWorld({ [meeting]: "intro\n#quick p2 Renommer ^t2abc\n" });
		expect(await w.plan()).toEqual([
			{ group: "error", key: `error:${meeting}:1`, path: meeting, title: "Renommer", error: "Une tâche rapide n'a pas de priorité" },
		]);
		w.files.set(meeting, "intro\n#quick Renommer ^t2abc\n");
		expect(await w.plan()).toMatchObject([{ group: "new", fields: { priority: "pq" } }]);
	});

	it("keeps a #quick step a step that inherits", async () => {
		const w = pushWorld({ [widget]: "---\nsuivi_id: p0002\npriority: 2\n---\n# Tasks\n- [ ] #quick Libellé ^s1xyz\n" });
		expect(await w.push()).toEqual({ applied: 2, failed: [] });
		expect(w.app.held.get("s1xyz")!.fields).toMatchObject({ type: "quick", step: true, priority: null });
	});

	it("writes a Rapide taken out of the Frigo in the app as no token on its line", async () => {
		const w = pushWorld({ [meeting]: "#quick pz Renommer ^t2abc\n" }, [
			appTask("t2abc", { ...rapide, priority: "pq" }, { base: { path: meeting, fields: rapide }, priority_by: "jmj" }),
		]);
		expect((await w.pull()).applied).toBe(1);
		expect(w.files.get(meeting)).toBe("#quick Renommer ^t2abc\n");
		expect(await w.plan()).toEqual([]);
	});

	it("are refused by the fake app as the app words it", async () => {
		const w = pushWorld({});
		const push = (fields: Record<string, unknown>, kind: "task" | "project" = "task") =>
			w.app.remote.push([{ op: "create", kind, fields } as never]);
		expect(await push({ ...rapide, priority: 2 })).toEqual([{ ok: false, error: "Une tâche rapide n'a pas de priorité" }]);
		expect(await push({ ...heatmap, priority: "pq" })).toEqual([{ ok: false, error: "La priorité Rapide est celle d'une tâche rapide hors étapes" }]);
		expect(await push({ title: "W", description: "", priority: "pq", done: false, due_date: null }, "project")).toEqual([
			{ ok: false, error: "Un projet n'a pas la priorité Rapide" },
		]);
	});
});

describe("The Frigo count", () => {
	it("counts the cards /frigo shows: open Projects at PZ, Tasks at PZ by their own Priority outside them", async () => {
		const frozen = { title: "Devis", description: "", priority: "pz" as const, done: false, due_date: null };
		const w = pushWorld({}, [
			appProject("p0002", frozen),
			appProject("p0003", { ...frozen, priority: 2, done: true }),
			appProject("p0004", { ...frozen, priority: 2 }),
			appTask("s1xyz", { ...heatmap, step: true, priority: null, project_id: "p0002" }),
			// Folded into its Project's card, gone with a Done Project; at PZ in an open Project, a card of its own.
			appTask("s2xyz", { ...heatmap, step: true, priority: "pz", project_id: "p0002" }),
			appTask("s3xyz", { ...heatmap, step: true, priority: "pz", project_id: "p0003" }),
			appTask("s4xyz", { ...heatmap, step: true, priority: "pz", project_id: "p0004" }),
			appTask("t1abc", { ...heatmap, priority: "pz" }),
			appTask("t2abc", { ...heatmap, priority: "pz" }, { archived: true }),
			appTask("t3abc", { ...heatmap, priority: null, done: true }),
			appTask("t4abc", { ...heatmap, type: "quick", priority: "pq" }),
			appTask("t5abc", { ...heatmap, priority: 2 }),
		]);
		expect(frigoCount((await w.pull()).app)).toBe(3);
	});
});
