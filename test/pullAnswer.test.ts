import { describe, expect, it } from "vitest";
import type { ItemAnswer, ProjectFields, TaskFields } from "../src/remote/api";
import type { PendingConflict } from "../src/sync/conflicts";
import type { PendingChange } from "../src/sync/pushPlan";
import { appProject, appTask, pushWorld } from "./fakeSuivi";

const meeting = "1.meetings/m.md";
const project = "2.projects/Widget.md";
const projectNote = "---\nsuivi_id: p0002\nstatus: a valider\npriority: pr\n---\n# Tasks\n- [ ] #bug pr Export ^s9xyz\n";
const tagTask: TaskFields = { title: "Heatmap", type: "task", step: false, priority: "pr", done: false, project_id: null, description: "notes" };
const step: TaskFields = { title: "Export", type: "bug", step: true, priority: "pr", done: false, project_id: "p0002", description: "" };
const widget: ProjectFields = { title: "Widget", description: "", priority: "pr", done: false, due_date: null };
const AT = "2026-10-21T09:30:00.000Z";

/** What an Answer makes of the app's fields. */
function answeredFields(kind: "project" | "task", answer: ItemAnswer) {
	if (answer === "a_reprendre") return { priority: 0 } as const;
	return kind === "project" ? ({ priority: null, done: true } as const) : ({ priority: null, done: true, done_on: "2026-10-21" } as const);
}

/** The vault and app agree on everything (bases = vault); the Client answered `item`, if given. */
function world(answer?: { item: "t7f3a" | "s9xyz" | "p0002"; answer: ItemAnswer }) {
	const state = { answer: { id: 1, answer: answer?.answer ?? "valide", at: AT, by: "jmj" } };
	const more = (id: string) => (answer?.item === id ? state : {});
	const change = (id: string, kind: "project" | "task") => (answer?.item === id ? answeredFields(kind, answer.answer) : {});
	return pushWorld({ [meeting]: "#task pr Heatmap ^t7f3a\n\tnotes", [project]: projectNote }, [
		appProject("p0002", { ...widget, ...change("p0002", "project") }, { base: { path: project, fields: widget }, ...more("p0002") }),
		appTask("t7f3a", { ...tagTask, ...change("t7f3a", "task") }, { base: { path: meeting, fields: tagTask }, ...more("t7f3a") }),
		appTask("s9xyz", { ...step, ...change("s9xyz", "task") }, { base: { path: project, fields: step }, ...more("s9xyz") }),
	]);
}

/** The Push review's only entry, a conflict. */
function onlyConflict(pending: PendingChange[]): PendingConflict {
	expect(pending.map((c) => c.group)).toEqual(["conflict"]);
	return pending[0] as PendingConflict;
}

describe("Pull: Answers on Tasks", () => {
	it("Validé on a Tag task: the line becomes #done <date>, the Answer is acknowledged, nothing left to push", async () => {
		const w = world({ item: "t7f3a", answer: "valide" });
		expect(await w.pull()).toMatchObject({ applied: 1, conflicts: [], failed: [] });
		expect(w.files.get(meeting)).toBe("#done 2026-10-21 Heatmap ^t7f3a\n\tnotes");
		expect(w.app.held.get("t7f3a")!.answer).toBeNull();
		expect(await w.plan()).toEqual([]);
		expect((await w.pull()).applied).toBe(0);
	});

	it("Validé on a Project step: the box is ticked with the Answer's day, nothing left to push", async () => {
		const w = world({ item: "s9xyz", answer: "valide" });
		expect((await w.pull()).applied).toBe(1);
		expect(w.files.get(project)).toContain("- [x] #bug 2026-10-21 Export ^s9xyz");
		expect(await w.plan()).toEqual([]);
	});

	it("À reprendre: the line gets p0, nothing left to push", async () => {
		const w = world({ item: "t7f3a", answer: "a_reprendre" });
		expect((await w.pull()).applied).toBe(1);
		expect(w.files.get(meeting)).toBe("#task p0 Heatmap ^t7f3a\n\tnotes");
		expect(await w.plan()).toEqual([]);
	});

	it("À reprendre on a Rapide: back to Rapide, the line loses its token, nothing left to push", async () => {
		const quick: TaskFields = { ...tagTask, title: "Marge", type: "quick", description: "" };
		const w = pushWorld({ [meeting]: "#quick pr Marge ^q1abc" }, [
			appTask("q1abc", { ...quick, priority: "pq" }, { base: { path: meeting, fields: quick }, answer: { id: 1, answer: "a_reprendre", at: AT, by: "jmj" } }),
		]);
		expect((await w.pull()).applied).toBe(1);
		expect(w.files.get(meeting)).toBe("#quick Marge ^q1abc");
		expect(w.app.held.get("q1abc")!.answer).toBeNull();
		expect(await w.plan()).toEqual([]);
	});

	it("a vault that already holds the Answer only acknowledges it", async () => {
		const w = world({ item: "t7f3a", answer: "a_reprendre" });
		w.files.set(meeting, "#task p0 Heatmap ^t7f3a\n\tnotes");
		expect((await w.pull()).applied).toBe(0);
		expect(w.app.acknowledged).toEqual([[{ id: "t7f3a", answer: 1, base: { path: meeting, fields: { ...tagTask, priority: 0 } } }]]);
		expect(await w.plan()).toEqual([]);
	});
});

describe("Pull: Answers on Projects", () => {
	it("Validé: the note gets archived: true, nothing left to push", async () => {
		const w = world({ item: "p0002", answer: "valide" });
		expect((await w.pull()).applied).toBe(1);
		expect(w.files.get(project)).toContain("archived: true");
		expect(await w.plan()).toEqual([]);
	});

	it("À reprendre: the note gets priority: 0, its status: key untouched, nothing left to push", async () => {
		const w = world({ item: "p0002", answer: "a_reprendre" });
		expect((await w.pull()).applied).toBe(1);
		expect(w.files.get(project)).toContain("priority: 0\n");
		expect(w.files.get(project)).toContain("status: a valider");
		expect(await w.plan()).toEqual([]);
	});
});

describe("Conflicts", () => {
	it("a priority both sides changed: nothing written, the field held out of the Push, (moi) pushes it with its expected value", async () => {
		const w = world();
		w.app.held.get("p0002")!.fields.priority = 1;
		w.app.held.get("p0002")!.priority_by = "jmj";
		w.files.set(project, projectNote.replace("priority: pr", "priority: 4"));
		const { conflicts } = await w.pull();
		expect(w.files.get(project)).toContain("priority: 4");
		expect(conflicts.map((c) => [c.key, c.mine.label, c.theirs.label, c.theirs.by])).toEqual([["p0002:priority", "P4", "P1", "jmj"]]);

		const c = onlyConflict(await w.plan());
		await w.pick(c.conflict, "mine");
		expect(w.app.received.at(-1)).toEqual([
			{ op: "update", kind: "project", id: "p0002", fields: { priority: 4 }, expected: { priority: 1 }, base: { path: project, fields: { ...widget, priority: 4 } } },
		]);
		expect(await w.plan()).toEqual([]);
		expect((await w.pull()).conflicts).toEqual([]);
	});

	it("a priority both sides changed: (jmj) writes the app's value into the vault and acknowledges it", async () => {
		const w = world();
		w.app.held.get("t7f3a")!.fields = { ...w.app.held.get("t7f3a")!.fields, priority: 1 };
		w.files.set(meeting, "#task p3 Heatmap ^t7f3a\n\tnotes");
		const [conflict] = (await w.pull()).conflicts;
		expect([conflict!.mine.label, conflict!.theirs.label, conflict!.theirs.by]).toEqual(["P3", "P1", null]);

		await w.pick(conflict!, "theirs");
		expect(w.files.get(meeting)).toBe("#task p1 Heatmap ^t7f3a\n\tnotes");
		expect(w.app.held.get("t7f3a")!.base).toEqual({ path: meeting, fields: { ...tagTask, priority: 1 } });
		expect(await w.plan()).toEqual([]);
	});

	it("(moi) is refused when the app moved again since the Pull", async () => {
		const w = world();
		w.app.held.get("p0002")!.fields.priority = 1;
		w.files.set(project, projectNote.replace("priority: pr", "priority: 4"));
		const [conflict] = (await w.pull()).conflicts;
		w.app.held.get("p0002")!.fields.priority = 5;
		await expect(w.pick(conflict!, "mine")).rejects.toThrow("priority a changé dans l'app");
	});

	it("an Answer on a Task changed in the vault is one unit: (jmj) writes p0, (moi) pushes Priority and Done", async () => {
		const theirs = world({ item: "t7f3a", answer: "a_reprendre" });
		theirs.files.set(meeting, "#task p3 Heatmap ^t7f3a\n\tnotes");
		const c = onlyConflict(await theirs.plan());
		expect(c.conflict).toMatchObject({ unit: "answer", held: ["priority", "done", "done_on"], mine: { label: "P3" }, theirs: { label: "À reprendre", by: "jmj" } });
		await theirs.pick(c.conflict, "theirs");
		expect(theirs.files.get(meeting)).toBe("#task p0 Heatmap ^t7f3a\n\tnotes");
		expect(theirs.app.held.get("t7f3a")!.answer).toBeNull();
		expect(await theirs.plan()).toEqual([]);

		const mine = world({ item: "t7f3a", answer: "valide" });
		mine.files.set(meeting, "#task p3 Heatmap ^t7f3a\n\tnotes");
		await mine.pick(onlyConflict(await mine.plan()).conflict, "mine");
		expect(mine.app.received.at(-1)![0]).toMatchObject({ fields: { priority: 3, done: false }, expected: { priority: null, done: true } });
		expect(mine.app.held.get("t7f3a")!.answer).toBeNull();
		expect(await mine.plan()).toEqual([]);
		expect((await mine.pull()).applied).toBe(0);
	});

	it("an Answer on a Project put at P3: (jmj) archives it", async () => {
		const w = world({ item: "p0002", answer: "valide" });
		w.files.set(project, projectNote.replace("priority: pr", "priority: 3"));
		expect((await w.pull()).applied).toBe(0);
		const c = onlyConflict(await w.plan());
		expect([c.conflict.mine.label, c.conflict.theirs.label]).toEqual(["P3", "Validé"]);
		await w.pick(c.conflict, "theirs");
		expect(w.files.get(project)).toContain("archived: true");
		expect(await w.plan()).toEqual([]);
	});

	it("is gone once the vault holds the app's value", async () => {
		const w = world({ item: "p0002", answer: "a_reprendre" });
		w.files.set(project, projectNote.replace("priority: pr", "priority: 3"));
		expect((await w.pull()).conflicts).toHaveLength(1);
		w.files.set(project, projectNote.replace("priority: pr", "priority: 0"));
		expect((await w.pull()).conflicts).toEqual([]);
		expect(await w.plan()).toEqual([]);
	});

	it("holds the conflicting field out of a change, and pushes the others", async () => {
		const w = world();
		w.app.held.get("p0002")!.fields.priority = 1;
		w.files.set(project, projectNote.replace("priority: pr", "priority: 4").replace("# Tasks", "# Description\nNouveau\n# Tasks"));
		const pending = await w.plan();
		expect(pending.map((c) => c.group)).toEqual(["changed", "conflict"]);
		expect(pending[0]).toMatchObject({ change: { fields: { description: "Nouveau" } }, fields: { priority: "pr" } });
	});
});
