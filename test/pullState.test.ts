import { describe, expect, it } from "vitest";
import type { ProjectFields, TaskFields } from "../src/remote/api";
import { appProject, appTask, pushWorld } from "./fakeSuivi";

const meeting = "1.meetings/m.md";
const project = "2.projects/Widget.md";
const heatmap: TaskFields = { title: "Heatmap", type: "task", step: false, status: "a_faire", priority: 3, project_id: null, description: "" };
const widget: ProjectFields = { title: "Widget", description: "", status: "a_faire", priority: 3 };

/** A Tag task `^t7f3a` at P3 in the vault and in the app's base, the app at `appPriority` (set by @jmj when it differs). */
function taskWorld(line: string, appPriority: number) {
	return pushWorld({ [meeting]: `${line} ^t7f3a\n` }, [
		appTask("t7f3a", { ...heatmap, priority: appPriority }, {
			base: { path: meeting, fields: heatmap },
			priority_by: appPriority === 3 ? null : "jmj",
		}),
	]);
}

describe("Pull compares state", () => {
	it("writes a Client priority into the Task line, acknowledges it, and the Push then has nothing", async () => {
		const w = taskWorld("#task p3 Heatmap", 1);
		const outcome = await w.pull();
		expect(outcome.applied).toBe(1);
		expect(w.files.get(meeting)).toBe("#task p1 Heatmap ^t7f3a\n");
		expect(w.app.held.get("t7f3a")!.base).toEqual({ path: meeting, fields: { ...heatmap, priority: 1 } });
		expect(await w.plan()).toEqual([]);
		expect((await w.pull()).applied).toBe(0);
	});

	it("writes a Client priority into a Project's frontmatter", async () => {
		const w = pushWorld({ [project]: "---\nsuivi_id: p0002\npriority: 3\n---\n" }, [
			appProject("p0002", { ...widget, priority: 2 }, { base: { path: project, fields: widget } }),
		]);
		await w.pull();
		expect(w.files.get(project)).toContain("priority: 2");
		expect(await w.plan()).toEqual([]);
	});

	it("a vault reverted to the old priority is offered by the Push and not pulled again", async () => {
		const w = taskWorld("#task p3 Heatmap", 1);
		await w.pull();
		w.files.set(meeting, "#task p3 Heatmap ^t7f3a\n");
		expect((await w.pull()).applied).toBe(0);
		expect(w.files.get(meeting)).toBe("#task p3 Heatmap ^t7f3a\n");
		expect((await w.plan()).map((c) => c.group)).toEqual(["changed"]);
	});

	it("aligns the base when the vault already holds the app's value", async () => {
		const w = taskWorld("#task p1 Heatmap", 1);
		expect((await w.pull()).applied).toBe(0);
		expect(w.app.held.get("t7f3a")!.base).toEqual({ path: meeting, fields: { ...heatmap, priority: 1 } });
	});

	it("a vault pointed at a fresh app pulls nothing", async () => {
		const w = pushWorld({ [meeting]: "#task p3 Heatmap ^t7f3a\n" });
		expect(await w.pull()).toMatchObject({ applied: 0, conflicts: [], failed: [] });
		expect(w.files.get(meeting)).toBe("#task p3 Heatmap ^t7f3a\n");
	});

	it("leaves the Items of an unreadable Project note alone", async () => {
		const note = "---\nsuivi_id: p0002\nstatus: bof\npriority: 3\n---\n# Tasks\n- [ ] p3 Export ^s9xyz\n";
		const w = pushWorld({ [project]: note }, [
			appProject("p0002", { ...widget, priority: 1 }, { base: { path: project, fields: widget } }),
			appTask("s9xyz", { ...heatmap, step: true, priority: 1 }, { base: { path: project, fields: { ...heatmap, step: true } } }),
		]);
		expect((await w.pull()).applied).toBe(0);
		expect(w.files.get(project)).toBe(note);
	});
});
