import { describe, expect, it } from "vitest";
import type { TaskFields } from "../src/remote/api";
import type { LocalTask } from "../src/sync/sharedTask";
import { planTaskPush, type ProjectLinks, type PushedTasks } from "../src/sync/taskPlan";
import { appWith } from "./fakeSuivi";

const now = new Date("2026-10-20T10:00:00Z");
const projects: ProjectLinks = {
	"2.projects/Tetris.md": { id: "p0001", title: "Tetris" },
	"2.projects/Widget.md": { id: "p0002", title: "Widget" },
	"2.projects/Nouveau.md": { title: "Nouveau" },
	"2.projects/Secret.md": { hidden: true, title: "Secret" },
};

const task = (over: Partial<LocalTask> = {}): LocalTask => ({
	path: "1.meetings/m.md",
	line: 3,
	raw: "#task p2 Widget saison",
	projectPath: null,
	title: "Widget saison",
	type: "task",
	step: false,
	status: "a_faire",
	priority: 2,
	description: "",
	...over,
});
const fields: TaskFields = { title: "Widget saison", type: "task", step: false, status: "a_faire", priority: 2, project_id: null, description: "" };
const plan = (local: LocalTask[], pushed: PushedTasks = {}) => ({
	changes: planTaskPush(local, projects, appWith({}, pushed), { now }),
});

describe("planTaskPush", () => {
	it("offers a Task line without block ID as new, linked to its Project", () => {
		const { changes } = plan([task({ projectPath: "2.projects/Tetris.md" })]);
		expect(changes).toMatchObject([
			{
				group: "new",
				title: "Widget saison",
				path: "1.meetings/m.md",
				ref: { line: 3, raw: "#task p2 Widget saison" },
				change: { op: "create", kind: "task", fields: { ...fields, project_id: "p0001" } },
			},
		]);
	});

	it("never offers the Tasks of a hidden (prive) Project", () => {
		expect(plan([task({ projectPath: "2.projects/Secret.md" })]).changes).toEqual([]);
	});

	it("waits for a Project pushed in the same Push", () => {
		const { changes } = plan([task({ projectPath: "2.projects/Nouveau.md" })]);
		expect(changes).toMatchObject([{ group: "new", needsProject: "2.projects/Nouveau.md" }]);
	});

	it("shows a moved line as a change of Project, not delete + create", () => {
		const pushed = { t7f3a: { path: "1.meetings/m.md", fields: { ...fields, project_id: "p0001" } } };
		const moved = task({ path: "2.projects/Widget.md", blockId: "t7f3a", projectPath: "2.projects/Widget.md" });
		expect(plan([moved], pushed).changes).toMatchObject([
			{
				group: "changed",
				id: "t7f3a",
				diffs: [{ field: "project", from: "Tetris", to: "Widget" }],
				change: { op: "update", kind: "task", id: "t7f3a", fields: { project_id: "p0002" } },
			},
		]);
	});

	it("shows a changed body as a Description diff, first line of the text as preview, (vide) when emptied", () => {
		const pushed = { t7f3a: { path: "1.meetings/m.md", fields: { ...fields, description: "Ancien corps\nsuite" } } };
		const edited = task({ blockId: "t7f3a", description: "Nouveau corps\n\n![[capture.png]]" });
		expect(plan([edited], pushed).changes).toMatchObject([
			{
				group: "changed",
				diffs: [{ field: "description", from: "Ancien corps", to: "Nouveau corps" }],
				change: { op: "update", kind: "task", id: "t7f3a", fields: { description: "Nouveau corps\n\n![[capture.png]]" } },
			},
		]);
		expect(plan([task({ blockId: "t7f3a" })], pushed).changes).toMatchObject([
			{ diffs: [{ field: "description", from: "Ancien corps", to: "(vide)" }], change: { fields: { description: "" } } },
		]);
		expect(plan([task({ description: "Corps" })]).changes).toMatchObject([
			{ group: "new", change: { op: "create", fields: { ...fields, description: "Corps" } } },
		]);
	});

	it("pushes a Project step with its type tag and the step flag; a changed tag is a type diff", () => {
		const step = task({ type: "bug", step: true, priority: null, raw: "- [ ] #bug Axe", path: "2.projects/Tetris.md", projectPath: "2.projects/Tetris.md" });
		expect(plan([step]).changes).toMatchObject([
			{ group: "new", detail: "Bug · À faire · Tetris", change: { fields: { type: "bug", step: true, priority: null, project_id: "p0001" } } },
		]);
		const pushed = { s1xyz: { path: "2.projects/Tetris.md", fields: { ...fields, type: "task" as const, step: true, priority: null, project_id: "p0001" } } };
		expect(plan([{ ...step, blockId: "s1xyz" }], pushed).changes).toMatchObject([
			{ group: "changed", diffs: [{ field: "type", from: "Tâche", to: "Bug" }], change: { fields: { type: "bug" } } },
		]);
	});

	it("shows a line moved between a Project's steps and a Tag task as a step diff", () => {
		const pushed = { t7f3a: { path: "1.meetings/m.md", fields } };
		const moved = task({ blockId: "t7f3a", step: true });
		expect(plan([moved], pushed).changes).toMatchObject([
			{ group: "changed", diffs: [{ field: "step", from: "non", to: "oui" }], change: { fields: { step: true } } },
		]);
	});

	it("offers nothing for an unchanged pushed Task, nor when its line is gone (Unplaced)", () => {
		const pushed = { t7f3a: { path: "1.meetings/m.md", fields } };
		expect(plan([task({ blockId: "t7f3a" })], pushed).changes).toEqual([]);
		expect(plan([], pushed).changes).toEqual([]);
	});

	it("pushes #done with its date, keeping the type last pushed", () => {
		const pushed = { t7f3a: { path: "1.meetings/m.md", fields: { ...fields, type: "bug" as const } } };
		const done = task({ blockId: "t7f3a", type: null, status: "termine", priority: null, doneOn: "2026-10-19" });
		expect(plan([done], pushed).changes).toMatchObject([
			{
				group: "changed",
				change: { fields: { status: "termine", priority: null, done_on: "2026-10-19" } },
			},
		]);
		expect((plan([done], pushed).changes[0]!.change as { fields: object }).fields).not.toHaveProperty("type");
	});

	it("leaves out items done more than 30 days ago that were never pushed", () => {
		const recent = task({ type: null, status: "termine", priority: null, doneOn: "2026-09-25", title: "Récent" });
		const old = task({ type: null, status: "termine", priority: null, doneOn: "2026-09-10", title: "Vieux" });
		expect(plan([recent, old]).changes.map((c) => c.title)).toEqual(["Récent"]);
	});

	it("lists undated done items never pushed as « Terminées sans date », unticked at a first Push", () => {
		const step = task({ type: "task", step: true, status: "termine", priority: null, raw: "- [x] Ancienne", path: "2.projects/Tetris.md", projectPath: "2.projects/Tetris.md" });
		expect(plan([step]).changes).toMatchObject([{ group: "new", undated: true, ticked: false }]);
		const app = appWith({}, { t7f3a: { path: "1.meetings/m.md", fields } });
		expect(planTaskPush([step], projects, app, { now })).toMatchObject([{ group: "new", undated: true, ticked: true }]);
	});

	it("counts a copied block ID once", () => {
		const pushed = { t7f3a: { path: "1.meetings/m.md", fields } };
		const a = task({ blockId: "t7f3a" });
		const b = task({ blockId: "t7f3a", path: "x.md", title: "Copie" });
		expect(plan([a, b], pushed).changes).toEqual([]);
	});
});
