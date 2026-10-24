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

	it("a priority conflict where the vault changed the status: each button shows what its line would be", async () => {
		const w = pushWorld({ [meeting]: "#task pr Heatmap ^t7f3a\n" }, [
			appTask("t7f3a", { ...heatmap, status: "a_valider", priority: 1 }, { base: { path: meeting, fields: heatmap }, priority_by: "jmj" }),
		]);
		const { conflicts } = await w.pull();
		expect(conflicts).toMatchObject([{ unit: "priority", mine: { label: "À valider" }, theirs: { label: "P1", by: "jmj" } }]);
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

describe("Pull of the Échéance", () => {
	const dated: ProjectFields = { ...widget, due_date: "2027-01-15" };
	/** Widget due 15 janv. 2027 in the vault and the Base, the app at `due_date` (set by @jmj). */
	function dueWorld(note: string, due_date: string | null) {
		return pushWorld({ [project]: note }, [
			appProject("p0002", { ...dated, due_date }, { base: { path: project, fields: dated }, due_date_by: "jmj" }),
		]);
	}
	const note = "---\nsuivi_id: p0002\npriority: 3\ndue_date: 2027-01-15\n---\n";

	it("writes the app's Échéance into the frontmatter and acknowledges it; the Push then has nothing", async () => {
		const w = dueWorld(note, "2027-02-01");
		expect((await w.pull()).applied).toBe(1);
		expect(w.files.get(project)).toBe("---\nsuivi_id: p0002\npriority: 3\ndue_date: 2027-02-01\n---\n");
		expect(w.app.held.get("p0002")!.base).toEqual({ path: project, fields: { ...dated, due_date: "2027-02-01" } });
		expect(await w.plan()).toEqual([]);
		expect((await w.pull()).applied).toBe(0);
	});

	it("adds the key when the vault has none", async () => {
		const w = pushWorld({ [project]: "---\nsuivi_id: p0002\npriority: 3\n---\n" }, [
			appProject("p0002", dated, { base: { path: project, fields: widget } }),
		]);
		await w.pull();
		expect(w.files.get(project)).toBe("---\nsuivi_id: p0002\npriority: 3\ndue_date: 2027-01-15\n---\n");
		expect(await w.plan()).toEqual([]);
	});

	it("removes the key when the app cleared it", async () => {
		const w = dueWorld(note, null);
		expect((await w.pull()).applied).toBe(1);
		expect(w.files.get(project)).toBe("---\nsuivi_id: p0002\npriority: 3\n---\n");
		expect(w.app.held.get("p0002")!.base).toEqual({ path: project, fields: { ...dated, due_date: null } });
		expect(await w.plan()).toEqual([]);
	});

	describe("both sides changed it", () => {
		const changed = note.replace("2027-01-15", "2027-03-01");

		it("is a conflict with both dates and who set the app's, the field held out of the Push", async () => {
			const w = dueWorld(changed, "2027-02-01");
			const { conflicts } = await w.pull();
			expect(w.files.get(project)).toBe(changed);
			expect(conflicts.map((c) => [c.key, c.unit, c.mine.label, c.theirs.label, c.theirs.by])).toEqual([
				["p0002:due_date", "due_date", "1 mars 2027", "1 févr. 2027", "jmj"],
			]);
			expect((await w.plan()).map((p) => p.group)).toEqual(["conflict"]);
		});

		it("a cleared side reads « Aucune »", async () => {
			const w = dueWorld(changed, null);
			const { conflicts } = await w.pull();
			expect(conflicts.map((c) => [c.mine.label, c.theirs.label])).toEqual([["1 mars 2027", "Aucune"]]);
		});

		it("(moi) pushes the vault's date with the app's as expected", async () => {
			const w = dueWorld(changed, "2027-02-01");
			const [conflict] = (await w.pull()).conflicts;
			await w.pick(conflict!, "mine");
			expect(w.app.received.at(-1)).toEqual([
				{
					op: "update",
					kind: "project",
					id: "p0002",
					fields: { due_date: "2027-03-01" },
					expected: { due_date: "2027-02-01" },
					base: { path: project, fields: { ...dated, due_date: "2027-03-01" } },
				},
			]);
			expect(await w.plan()).toEqual([]);
			expect((await w.pull()).conflicts).toEqual([]);
		});

		it("(jmj) writes the app's date into the vault and acknowledges it", async () => {
			const w = dueWorld(changed, null);
			const [conflict] = (await w.pull()).conflicts;
			await w.pick(conflict!, "theirs");
			expect(w.files.get(project)).toBe("---\nsuivi_id: p0002\npriority: 3\n---\n");
			expect(w.app.held.get("p0002")!.base).toEqual({ path: project, fields: { ...dated, due_date: null } });
			expect(await w.plan()).toEqual([]);
			expect((await w.pull()).conflicts).toEqual([]);
		});
	});
});
