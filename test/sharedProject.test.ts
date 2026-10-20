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
	it("shares the file name as title, the Description section, status and priority", () => {
		const result = readSharedProject(
			"2.projects/Widget saison.md",
			note("priority: 2\nstatus: En cours\nsuivi_id: t7f3a", body),
		);

		expect(result).toEqual({
			ok: true,
			project: {
				path: "2.projects/Widget saison.md",
				suiviId: "t7f3a",
				archived: false,
				fields: {
					title: "Widget saison",
					description: "Un **widget** pour la saison.\n\n- carte",
					status: "en_cours",
					priority: 2,
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

	it("reads every status label, with or without accents, and archived: true as Terminé", () => {
		const status = (fm: string) => {
			const r = readSharedProject("p/X.md", note(fm, ""));
			return r?.ok ? r.project.fields.status : r;
		};

		expect(status("status: À faire")).toBe("a_faire");
		expect(status("status: en pause")).toBe("en_pause");
		expect(status('status: "À valider"')).toBe("a_valider");
		expect(status("status: Termine")).toBe("termine");
		expect(status("archived: true\nstatus: En cours")).toBe("termine");
		expect(status("priority: 3")).toBe("a_faire");
	});

	it("reports an unknown status instead of guessing", () => {
		const r = readSharedProject("p/X.md", note("status: Fini\nsuivi_id: t7f3a", ""));

		expect(r).toEqual({ ok: false, path: "p/X.md", suiviId: "t7f3a", error: expect.stringContaining("Fini") });
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
});
