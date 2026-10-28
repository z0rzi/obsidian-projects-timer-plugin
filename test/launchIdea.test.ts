import { describe, expect, it } from "vitest";
import { runLaunchIdea, type LaunchIdeaDeps } from "../src/inbox/launchIdea";
import type { ProjectFields } from "../src/remote/api";
import { shareBody } from "../src/sync/sharedBody";
import { readSharedProject } from "../src/sync/sharedProject";
import { appTask, fakeLinks, pushWorld } from "./fakeSuivi";

/** The vault's `8.templates/project.md`. */
const TEMPLATE = "---\npriority: 5\n---\n\n# Time usage\n---\n```project\n```\n\n# Tasks\n---";
const DAILY = "1.meetings/2026-10-20.md";
const PROJECT = "2.projects/Carte des flux.md";
const LINE = "#idea pz Carte des flux ^i4k2z";
const NOTE = ["# Notes", "#task p2 Avant", LINE, "\tVoir les flux", "\t- une carte ![[carte.png]]", "", "Suite"].join("\n");
const IDEA_FIELDS = { title: "Carte des flux", type: "idea", priority: "pz", description: "Voir les flux\n- une carte ![[carte.png]]" } as const;

/** A vault holding the daily note, an app holding its pushed `#idea` line (and `more`), and « Lancer en projet » on line `at`. */
function world(note = NOTE, more: Parameters<typeof appTask>[] = []) {
	const base = { path: DAILY, fields: { ...IDEA_FIELDS, step: false, done: false, project_id: null } };
	const w = pushWorld({ [DAILY]: note }, [
		appTask("i4k2z", IDEA_FIELDS, { base }),
		...more.map((args) => appTask(...args)),
	]);
	const deps: LaunchIdeaDeps = {
		remote: w.app.remote,
		folder: "2.projects",
		template: async () => TEMPLATE,
		exists: (path) => w.files.has(path),
		create: async (path, content) => {
			w.files.set(path, content);
		},
		process: (path, edit) => w.vault.process(path, edit),
		projects: { links: fakeLinks(() => [...w.files.keys()]), isProject: (p) => p.startsWith("2.projects/") },
		shareBody: (_path, body) => shareBody(body, (link) => w.app.remote.upload(new TextEncoder().encode(link).buffer as ArrayBuffer, link)),
	};
	const launch = async (at: number) => runLaunchIdea({ path: DAILY, content: w.files.get(DAILY)! }, at, deps);
	return { ...w, deps, launch };
}

describe("Lancer en projet", () => {
	it("reads the line as the Push does: a bare [[Project]] first body line is its Project link, not the description", async () => {
		const note = ["# Notes", LINE, "\t[[Widget]]", "\tVoir les flux", ""].join("\n");
		const w = world(note);
		w.files.set("2.projects/Widget.md", "---\nsuivi_id: p1abc\n---\n# Widget");
		expect(await w.launch(1)).toEqual({ ok: true, path: PROJECT });
		expect(w.app.held.get("i4k2z")!.fields.description).toBe("Voir les flux");
		expect(readSharedProject(PROJECT, w.files.get(PROJECT)!)).toMatchObject({ ok: true, project: { fields: { description: "Voir les flux" } } });
		expect(w.files.get(DAILY)).toBe(["# Notes", ""].join("\n"));
	});

	it("creates the Project note from the template with the line's id, title, Priority and body, and removes the line and its body", async () => {
		const w = world();

		expect(await w.launch(2)).toEqual({ ok: true, path: PROJECT });

		const content = w.files.get(PROJECT)!;
		expect(content).toContain("```project\n```");
		expect(content).toContain("# Tasks");
		expect(readSharedProject(PROJECT, content)).toEqual({
			ok: true,
			project: {
				path: PROJECT,
				suiviId: "i4k2z",
				fields: { title: "Carte des flux", description: IDEA_FIELDS.description, priority: "pz", done: false, due_date: null },
			},
		});
		expect(w.files.get(DAILY)).toBe(["# Notes", "#task p2 Avant", "", "Suite"].join("\n"));
	});

	it("launches it in the app, same id, the body shared and the note's fields as its base, so the next Push is clean", async () => {
		const w = world();
		await w.launch(2);

		const held = w.app.held.get("i4k2z")!;
		expect(held.kind).toBe("project");
		expect(held.fields).toEqual({
			title: "Carte des flux",
			description: "Voir les flux\n- une carte ![](/uploads/u0.png)",
			priority: "pz",
			done: false,
			due_date: null,
		} satisfies ProjectFields);
		expect(held.base).toEqual({
			path: PROJECT,
			fields: { title: "Carte des flux", description: IDEA_FIELDS.description, priority: "pz", done: false, due_date: null },
		});
		expect(await w.plan()).toMatchObject([{ title: "Avant" }]);
	});

	it("takes the line's rank, and P1 for a line without token", async () => {
		const ranked = world(NOTE.replace("#idea pz", "#idea p3"));
		await ranked.launch(2);
		expect(readSharedProject(PROJECT, ranked.files.get(PROJECT)!)).toMatchObject({ project: { fields: { priority: 3 } } });

		const bare = world(NOTE.replace("#idea pz", "#idea"));
		await bare.launch(2);
		expect(bare.app.held.get("i4k2z")!.fields).toMatchObject({ priority: 1 });
	});

	it("fills an existing # Description section, works without a template, and names the file after the title", async () => {
		for (const template of ["---\npriority: 5\nstatus: En pause\n---\n# Description\n---\n\n# Tasks\n", ""]) {
			const w = world();
			w.deps.template = async () => template;
			await w.launch(2);
			const content = w.files.get(PROJECT)!;
			expect(content.match(/# Description/g)).toHaveLength(1);
			expect(readSharedProject(PROJECT, content)).toMatchObject({ ok: true, project: { suiviId: "i4k2z", fields: w.app.held.get("i4k2z")!.base!.fields } });
		}
		const odd = world(NOTE.replace("Carte des flux ^", "Flux: A/B ? ^"));
		expect(await odd.launch(2)).toEqual({ ok: true, path: "2.projects/Flux A B.md" });
	});

	it("refuses a line that is not a pushed #idea, touching neither the app nor the vault", async () => {
		const w = world(NOTE.replace("#idea pz Carte des flux ^i4k2z", "#idea pz Carte des flux"));
		expect(await w.launch(1)).toEqual({ ok: false, error: "Placez le curseur sur une ligne #idea." });
		expect(await w.launch(3)).toEqual({ ok: false, error: "Placez le curseur sur une ligne #idea." });
		expect(await w.launch(2)).toEqual({ ok: false, error: "Cette idée n'est pas encore dans l'app : poussez-la d'abord." });
		expect(w.files.has(PROJECT)).toBe(false);
		expect(w.files.get(DAILY)).toBe(NOTE.replace(" ^i4k2z", ""));
		expect(w.app.held.get("i4k2z")!.kind).toBe("task");
	});

	it("touches nothing when the Project note already exists", async () => {
		const w = world();
		w.files.set(PROJECT, "mine");
		expect(await w.launch(2)).toEqual({ ok: false, error: `${PROJECT} existe déjà.` });
		expect(w.files.get(PROJECT)).toBe("mine");
		expect(w.files.get(DAILY)).toBe(NOTE);
		expect(w.app.held.get("i4k2z")!.kind).toBe("task");
	});

	it("writes nothing when the app refuses: an Idea not Triaged, or no longer a Task", async () => {
		const w = world();
		w.app.held.get("i4k2z")!.triaged = false;
		expect(await w.launch(2)).toEqual({ ok: false, error: "Suivi error (HTTP 409): Seule une idée triée devient un projet : i4k2z" });
		expect(w.files.has(PROJECT)).toBe(false);
		expect(w.files.get(DAILY)).toBe(NOTE);

		const bug = world(NOTE.replace("#idea pz Carte des flux ^i4k2z", "#idea pz Carte des flux ^bug01"), [["bug01", { title: "Carte des flux", type: "bug", priority: 2 }]]);
		expect(await bug.launch(2)).toMatchObject({ ok: false, error: expect.stringContaining("HTTP 409") });
	});
});
