import { describe, expect, it } from "vitest";
import { appProject, appTask, pushWorld as world } from "./fakeSuivi";

const turpe = "2.projects/Algorithme Turpe.md";
const talon = "2.projects/Talon Clinique.md";
const projectNote = (id: string) => `---\nsuivi_id: ${id}\npriority: 2\n---\n`;
const held = (id: string, path: string, title: string) => {
	const fields = { title, description: "", priority: 2, done: false, due_date: null };
	return appProject(id, fields, { base: { path, fields } });
};
const projects = [held("p0001", turpe, "Algorithme Turpe"), held("p0002", talon, "Talon Clinique")];
const notes = { [turpe]: projectNote("p0001"), [talon]: projectNote("p0002"), "3.notes/Compte rendu.md": "" };
const base = (fields: object) => ({ path: "m.md", fields: { title: "T", type: "task", step: false, priority: 1, done: false, project_id: null, description: "", ...fields } });

describe("Project link of a Tag task", () => {
	it("attaches by the line's link, then a bare-link first body line, then the note's project: frontmatter", async () => {
		const w = world(
			{
				...notes,
				"m.md": [
					"---",
					'project: "[[Talon Clinique]]"',
					"---",
					"#task p1 [[Compte rendu]] [[Algorithme Turpe]] A ^t0001",
					"  [[Talon Clinique]]",
					"#task p1 B ^t0002",
					"  [[2.projects/Algorithme Turpe]]",
					"  voir [[Talon Clinique]]",
					"#task p1 C ^t0003",
					"  voir [[Algorithme Turpe]]",
					"#task p1 [[Compte rendu]] D ^t0004",
				].join("\n"),
			},
			projects,
		);

		const pending = await w.plan();

		expect(pending.map((c) => [c.title, c.group, "fields" in c ? c.fields : undefined])).toMatchObject([
			["[[Compte rendu]] [[Algorithme Turpe]] A", "error", undefined],
			["B", "new", { project_id: "p0001", description: "voir [[Talon Clinique]]" }],
			["C", "new", { project_id: "p0002", description: "voir [[Algorithme Turpe]]" }],
			["[[Compte rendu]] D", "new", { project_id: "p0002" }],
		]);
		expect(pending[0]).toMatchObject({ error: "lié à deux projets : Algorithme Turpe et Talon Clinique" });
		await w.push();
		expect(w.app.received.flat().map((c) => "id" in c && c.id)).toEqual(["t0002", "t0003", "t0004"]);
	});

	it("shows no description change on a line whose body starts with the Project link, the app holding the body without it", async () => {
		const line = base({ project_id: "p0001", description: "corps" });
		const w = world({ ...notes, "m.md": "#task p1 T ^t7f3a\n\t[[Algorithme Turpe]]\n\tcorps\n" }, [...projects, appTask("t7f3a", line.fields, { base: line })]);

		expect(await w.plan()).toEqual([]);
	});

	it("pushes the body without the link line as the description and its base, then finds nothing to push", async () => {
		const w = world({ ...notes, "m.md": "#task p1 T\n\t[[Algorithme Turpe]]\n\tcorps\n" }, projects);

		await w.push();

		expect(w.app.received.flat()).toMatchObject([{ op: "create", fields: { project_id: "p0001", description: "corps" }, base: { fields: { description: "corps" } } }]);
		expect(await w.plan()).toEqual([]);
	});

	it("moves the Task when its link changes; the Pull leaves the link as written", async () => {
		const line = base({ title: "[[Talon Clinique]] T", project_id: "p0001" });
		const w = world({ ...notes, "m.md": "#task p1 [[Talon Clinique]] T ^t7f3a\n" }, [...projects, appTask("t7f3a", line.fields, { base: line })]);

		expect(await w.plan()).toMatchObject([{ group: "changed", diffs: [{ field: "project", from: "Algorithme Turpe", to: "Talon Clinique" }] }]);
		await w.push();
		expect(w.app.held.get("t7f3a")!.fields.project_id).toBe("p0002");

		w.app.held.get("t7f3a")!.fields.priority = 3;
		await w.pull();
		expect(w.files.get("m.md")).toBe("#task p3 [[Talon Clinique]] T ^t7f3a\n");
		expect(await w.plan()).toEqual([]);
	});
});
