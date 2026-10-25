import { describe, expect, it } from "vitest";
import { readSharedProject } from "../src/sync/sharedProject";

const note = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n${body}`;

const body = [
	"",
	"# Time usage",
	"---",
	"```project",
	"2026-10-19;420;Mise à jour algo PAC",
	"```",
	"",
	"# Description",
	"---",
	"Un **widget** pour la saison.",
	"",
	"- carte",
	"",
	"# Tasks",
	"---",
	"- [ ] p1 Étape privée de titre",
].join("\n");

describe("readSharedProject", () => {
	it("shares the file name as title, the Description section and priority", () => {
		const result = readSharedProject(
			"2.projects/Widget saison.md",
			note("priority: 2\nstatus: En cours\nsuivi_id: t7f3a", body),
		);

		expect(result).toEqual({
			ok: true,
			project: {
				path: "2.projects/Widget saison.md",
				suiviId: "t7f3a",
				fields: {
					title: "Widget saison",
					description: "Un **widget** pour la saison.\n\n- carte",
					priority: 2,
					done: false,
					due_date: null,
				},
			},
		});
	});

	it("never shares time logs or other sections", () => {
		const result = readSharedProject("p/X.md", note("priority: 1", body));
		const shared = JSON.stringify(result);

		expect(shared).not.toContain("Mise à jour algo PAC");
		expect(shared).not.toContain("Étape privée");
	});

	it("skips Projects marked prive: true", () => {
		expect(readSharedProject("p/X.md", note("prive: true\npriority: 1", body))).toBeNull();
	});

	it("reads priority: pr as PR, and archived: true as Done without a Priority", () => {
		const read = (fm: string) => {
			const r = readSharedProject("p/X.md", note(fm, ""));
			return r?.ok ? { priority: r.project.fields.priority, done: r.project.fields.done } : r;
		};

		expect(read("priority: pr")).toEqual({ priority: "pr", done: false });
		expect(read('priority: "pr"')).toEqual({ priority: "pr", done: false });
		expect(read("priority: PR")).toEqual({ priority: "pr", done: false });
		expect(read("priority: Pr")).toEqual({ priority: "pr", done: false });
		expect(read("priority: 0")).toEqual({ priority: 0, done: false });
		expect(read("archived: true\npriority: 3")).toEqual({ priority: null, done: true });
	});

	it("ignores the status: key of a Project note, whatever its value", () => {
		const r = readSharedProject("p/X.md", note("status: Fini\npriority: 2", ""));

		expect(r).toMatchObject({ ok: true, project: { fields: { priority: 2, done: false } } });
		expect(JSON.stringify(r)).not.toContain("Fini");
	});

	it("defaults a missing priority to P5 and an empty description when there is no section", () => {
		const r = readSharedProject("p/Sans frontmatter.md", "# Time usage\n---\n```project\n```\n");

		expect(r).toMatchObject({
			ok: true,
			project: { suiviId: undefined, fields: { title: "Sans frontmatter", description: "", priority: 5 } },
		});
	});

	it("keeps an all-digit suivi_id as written", () => {
		const r = readSharedProject("p/X.md", note('suivi_id: "00123"', ""));

		expect(r?.ok && r.project.suiviId).toBe("00123");
	});

	it("reads due_date as the Échéance; absent, empty or YAML null is none", () => {
		const dueDate = (fm: string) => {
			const r = readSharedProject("p/X.md", note(fm, ""));
			return r?.ok ? r.project.fields.due_date : r;
		};

		expect(dueDate("due_date: 2027-01")).toBe("2027-01");
		expect(dueDate('due_date: "2027-01"')).toBe("2027-01");
		expect(dueDate("due_date:")).toBeNull();
		expect(dueDate("due_date: null")).toBeNull();
		expect(dueDate("due_date: ~")).toBeNull();
		expect(dueDate("priority: 3")).toBeNull();
	});

	it("reports a due_date that isn't a month, a full day included, naming the note", () => {
		for (const value of ["fin janvier", "2027-01-15", "2027-13", "2027-1", "01/2027"]) {
			const r = readSharedProject("p/X.md", note(`due_date: ${value}\nsuivi_id: t7f3a`, ""));

			expect(r).toEqual({ ok: false, path: "p/X.md", suiviId: "t7f3a", error: `Invalid due_date "${value}" in p/X.md` });
		}
	});
});
