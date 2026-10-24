import { describe, expect, it } from "vitest";
import { InboxStore } from "../src/inbox/inboxStore";
import { projectFile, runNewProject, type NewProjectDeps } from "../src/inbox/newProject";
import type { ProjectFields, TriageRequest } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import { readSharedProject } from "../src/sync/sharedProject";

/** The vault's `8.templates/project.md`. */
const TEMPLATE = "---\npriority: 5\n---\n\n# Time usage\n---\n```project\n```\n\n# Tasks\n---";
const IDEA = { id: "i4k2z", title: "Carte des flux", description: "Voir les flux\n\n![](/uploads/abc.png)\n[plan.pdf](/uploads/plan.pdf)" };
/** The Idea's description as the vault writes it: its image copied in, its other upload pointing at the app. */
const IN_VAULT = "Voir les flux\n\n![[abc.png]]\n[plan.pdf](https://suivi.test/uploads/plan.pdf)";

function deps(overrides: Partial<NewProjectDeps> = {}) {
	const sent: [string, TriageRequest][] = [];
	const files = new Map<string, string>();
	/** Bases the app was sent, by id. */
	const bases: Record<string, { path: string; fields: ProjectFields }> = {};
	const d: NewProjectDeps = {
		remote: {
			async triage(id, as) {
				sent.push([id, as]);
				const priority = as.priority;
				const fields: ProjectFields = {
					title: IDEA.title,
					description: IDEA.description,
					status: priority === 0 ? "en_cours" : "a_faire",
					priority,
				};
				return { id, as: "project", fields };
			},
			async acknowledge(items) {
				for (const i of items) bases[i.id] = i.base as (typeof bases)[string];
			},
		},
		folder: "2.projects",
		template: async () => TEMPLATE,
		exists: (path) => files.has(path),
		create: async (path, content) => {
			files.set(path, content);
		},
		appUrl: "https://suivi.test",
		localImage: async (url) => url.slice(url.lastIndexOf("/") + 1),
		...overrides,
	};
	return { d, sent, files, bases };
}

describe("runNewProject (Nouveau projet)", () => {
	it("triages in the app, then creates the Project file from the template with suivi_id and the Idea's description, its images in the vault", async () => {
		const { d, sent, files, bases } = deps();
		const result = await runNewProject(IDEA, { priority: 2 }, d);

		expect(result).toEqual({ ok: true, path: "2.projects/Carte des flux.md" });
		expect(sent).toEqual([["i4k2z", { as: "project", priority: 2 }]]);
		const content = files.get("2.projects/Carte des flux.md")!;
		expect(content).toContain("```project\n```");
		expect(content).toContain("# Tasks");
		expect(readSharedProject("2.projects/Carte des flux.md", content)).toEqual({
			ok: true,
			project: {
				path: "2.projects/Carte des flux.md",
				suiviId: "i4k2z",
				archived: false,
				fields: { title: "Carte des flux", description: IN_VAULT, status: "a_faire", priority: 2, due_date: null },
			},
		});
		expect(bases.i4k2z).toEqual({
			path: "2.projects/Carte des flux.md",
			fields: { title: "Carte des flux", description: IN_VAULT, status: "a_faire", priority: 2 },
		});
	});

	it("writes En cours for P0, so the next Push sees no change", async () => {
		const { d, files, bases } = deps();
		await runNewProject(IDEA, { priority: 0 }, d);
		const read = readSharedProject("2.projects/Carte des flux.md", files.get("2.projects/Carte des flux.md")!);
		expect(read).toMatchObject({ ok: true, project: { fields: bases.i4k2z!.fields } });
	});

	it("fills an existing # Description section and works without a template", async () => {
		for (const template of ["---\npriority: 5\nstatus: En pause\n---\n# Description\n---\n\n# Tasks\n", ""]) {
			const { d, files, bases } = deps({ template: async () => template });
			await runNewProject(IDEA, { priority: 4 }, d);
			const content = files.get("2.projects/Carte des flux.md")!;
			expect(content.match(/# Description/g)).toHaveLength(1);
			const read = readSharedProject("2.projects/Carte des flux.md", content);
			expect(read).toMatchObject({ ok: true, project: { suiviId: "i4k2z", fields: bases.i4k2z!.fields } });
		}
	});

	it("fills {{date}} with the local day, not the UTC one", () => {
		const fields: ProjectFields = { title: "X", description: "", status: "a_faire", priority: 3 };
		// 23:30 UTC on the 21st is already the 22nd in Paris.
		const content = projectFile("created {{date}}", "X", "xxxxx", fields, new Date("2026-10-21T23:30:00Z"));
		expect(content).toContain("created 2026-10-22");
	});

	it("names the file after the title without characters a file name can't hold", async () => {
		const { d, files } = deps();
		const result = await runNewProject({ ...IDEA, title: "Flux: A/B ?" }, { priority: 2 }, d);
		expect(result).toEqual({ ok: true, path: "2.projects/Flux A B.md" });
		expect(files.has("2.projects/Flux A B.md")).toBe(true);
	});

	it("touches neither the app nor the vault when the file already exists or no Projects folder is set", async () => {
		const taken = deps();
		taken.files.set("2.projects/Carte des flux.md", "mine");
		expect(await runNewProject(IDEA, { priority: 2 }, taken.d)).toEqual({
			ok: false,
			error: "2.projects/Carte des flux.md existe déjà.",
		});
		expect(taken.sent).toEqual([]);
		expect(taken.files.get("2.projects/Carte des flux.md")).toBe("mine");

		const noFolder = deps({ folder: "" });
		expect(await runNewProject(IDEA, { priority: 2 }, noFolder.d)).toMatchObject({ ok: false });
		expect(noFolder.sent).toEqual([]);
	});

	it("creates no file when the app refuses", async () => {
		const { d, files, bases } = deps();
		d.remote.triage = async () => {
			throw new Error("Suivi error (HTTP 409): Idée pas à trier : i4k2z");
		};
		expect(await runNewProject(IDEA, { priority: 2 }, d)).toEqual({
			ok: false,
			error: "Suivi error (HTTP 409): Idée pas à trier : i4k2z",
		});
		expect(files.size).toBe(0);
		expect(bases).toEqual({});
	});
});

describe("Inbox À trier with a launched Idea", () => {
	it("lists it as an Idée to triage", async () => {
		const to_triage = [{ ...IDEA, type: "idea", created_at: "2026-10-20T10:00:00.000Z", author_email: "jmj@edf.fr", urgency: null, project_id: null }];
		const remote = {
			inbox: async () => ({ notifications: [], to_triage }),
			activity: async () => ({ entries: [], next: null }),
		} as unknown as Remote;
		const store = new InboxStore(remote, () => {});
		await store.refresh();
		expect(store.current.toTriage).toEqual([
			expect.objectContaining({ kind: "ticket", ticketType: "idea", title: "Idée: Carte des flux" }),
		]);
	});
});
