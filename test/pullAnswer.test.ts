import { describe, expect, it } from "vitest";
import type { ApiEvent, ProjectFields, PushChange, PushResult, TaskFields } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { PULL_HANDLERS, runPull, type VaultFiles } from "../src/sync/runPull";
import { planTaskPush } from "../src/sync/taskPlan";
import { planProjectPush } from "../src/sync/pushPlan";
import { settleConflicts, withConflicts } from "../src/sync/conflicts";
import { runPush } from "../src/sync/runPush";
import { appWith } from "./fakeSuivi";
import { writeRemotePriority } from "../src/sync/pullPriority";
import { writeAnswer } from "../src/sync/pullAnswer";
import { readSharedProject, type SharedProject } from "../src/sync/sharedProject";
import { readProjectSteps, readTagTasks } from "../src/sync/sharedTask";

const meeting = "1.meetings/m.md";
const project = "2.projects/Widget.md";
const projectNote = "---\nsuivi_id: p0002\nstatus: a valider\npriority: 2\n---\n# Tasks\n- [ ] #bug pr Export ^s9xyz\n";
const tagTask: TaskFields = { title: "Heatmap", type: "task", step: false, status: "a_valider", priority: null, project_id: "p0002", description: "" };
const step: TaskFields = { title: "Export", type: "bug", step: true, status: "a_valider", priority: null, project_id: "p0002", description: "" };
const widget: ProjectFields = { title: "Widget", description: "", status: "a_valider", priority: 2 };

/** Obsidian's `processFrontMatter` on the flat `key: value` frontmatter of these notes. */
function editFrontmatter(content: string, edit: (fm: Record<string, unknown>) => void): string {
	const lines = content.split("\n");
	const end = lines.indexOf("---", 1);
	const fm: Record<string, unknown> = {};
	for (const line of lines.slice(1, end)) {
		const [key, ...rest] = line.split(":");
		const value = rest.join(":").trim();
		fm[key!.trim()] = value === "true" ? true : /^\d+$/.test(value) ? Number(value) : value;
	}
	edit(fm);
	const yaml = Object.entries(fm).map(([k, v]) => `${k}: ${String(v)}`);
	return ["---", ...yaml, ...lines.slice(end)].join("\n");
}

function world(events: Omit<ApiEvent, "id">[]) {
	const log: ApiEvent[] = events.map((e, i) => ({ ...e, id: i + 1 }));
	const files = new Map([
		[meeting, "#task pr Heatmap ^t7f3a\nnotes"],
		[project, projectNote],
	]);
	const vault: VaultFiles = {
		async read(path) {
			return files.get(path) ?? null;
		},
		async process(path, edit) {
			files.set(path, edit(files.get(path)!));
		},
		async processFrontMatter(path, edit) {
			files.set(path, editFrontmatter(files.get(path)!, edit));
		},
		paths: () => [...files.keys()],
	};
	const sync: SyncState = {
		pushedProjects: { p0002: { path: project, fields: { ...widget } } },
		pushedTasks: { t7f3a: { path: meeting, fields: { ...tagTask } }, s9xyz: { path: project, fields: { ...step } } },
	};
	const remote = {
		async pull(cursor: number | null) {
			const fresh = log.filter((e) => e.id > (cursor ?? 0));
			return { events: fresh, cursor: fresh.at(-1)?.id ?? cursor ?? 0 };
		},
	} as unknown as Remote;
	const pull = () => runPull({ remote, sync, save: async () => {}, files: vault }, PULL_HANDLERS);

	/** The Push modal's list from the vault as it is now, conflicts included. */
	const plan = () => {
		const read = readSharedProject(project, files.get(project)!);
		const projects: SharedProject[] = read?.ok ? [read.project] : [];
		const tasks = [...readTagTasks(meeting, files.get(meeting)!, project), ...readProjectSteps(project, files.get(project)!)];
		settleConflicts(sync, projects, tasks);
		const pending = [
			...planProjectPush(projects, appWith(sync.pushedProjects, sync.pushedTasks)),
			...planTaskPush(tasks, { [project]: { id: "p0002", title: "Widget" } }, appWith(sync.pushedProjects, sync.pushedTasks), {
				now: new Date("2026-10-21T10:00:00Z"),
			}),
		];
		return withConflicts(pending, sync, projects, tasks);
	};
	const received: PushChange[] = [];
	const push = (selected: ReturnType<typeof plan>) =>
		runPush(selected, {
			remote: {
				async push(changes) {
					received.push(...changes);
					// The app keeps the base each change carries; the next plan reads it back.
					for (const c of changes) if ("base" in c && c.base) Object.assign(c.kind === "task" ? sync.pushedTasks : sync.pushedProjects, { [c.id!]: c.base });
					return changes.map((c): PushResult => ({ ok: true, id: c.op === "create" ? "new" : c.id }));
				},
			} as Remote,
			sync,
			save: async () => {},
			writeSuiviId: async () => {},
			writeBlockId: async () => {},
			writeDoneDate: async () => {},
			writePriority: (kind, id, path, p) => writeRemotePriority(vault, kind, id, path, p),
			writeAnswer: (conflict) => writeAnswer(vault, conflict),
		});
	return { files, sync, pull, plan, push, received };
}

/**
 * `item.answered` on `item`, then the changes it causes as the app emits
 * them, tagged `answer: <id of the item.answered event>` (the first id is 1).
 */
function answered(item: string, answer: "valide" | "a_reprendre", changes: [string, unknown, unknown][] = []) {
	const at = "2026-10-21T09:30:00.000Z";
	const actor = "u-jmj";
	return [
		{ at, actor, origin: "site", type: "item.answered", item, payload: { answer, comment_id: null } },
		...changes.map(([field, from, to]) => ({
			at,
			actor,
			origin: "site",
			type: "item.updated",
			item,
			payload: { field, from, to, answer: 1 },
		})),
	] as Omit<ApiEvent, "id">[];
}

describe("Pull: Answers on Tasks", () => {
	it("Validé on a Tag task: the line becomes #done <date>, with nothing left to push", async () => {
		const w = world(answered("t7f3a", "valide", [["status", "a_valider", "termine"]]));
		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get(meeting)).toBe("#done 2026-10-21 Heatmap ^t7f3a\nnotes");
		expect(w.plan()).toEqual([]);
	});

	it("Validé on a Project step: the box is ticked, the token dropped and the Answer's day written, with nothing left to push", async () => {
		const w = world(answered("s9xyz", "valide", [["status", "a_valider", "termine"]]));
		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get(project)).toContain("- [x] #bug 2026-10-21 Export ^s9xyz");
		expect(w.plan()).toEqual([]);
	});

	it("À reprendre: the line gets p0, with nothing left to push", async () => {
		const w = world(
			answered("t7f3a", "a_reprendre", [
				["status", "a_valider", "en_cours"],
				["priority", null, 0],
			]),
		);
		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get(meeting)).toBe("#task p0 Heatmap ^t7f3a\nnotes");
		expect(w.plan()).toEqual([]);
	});
});

describe("Pull: Answers on Projects", () => {
	it("Validé: the note gets archived: true, with nothing left to push", async () => {
		const w = world(answered("p0002", "valide", [["status", "a_valider", "termine"]]));
		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get(project)).toBe(
			"---\nsuivi_id: p0002\nstatus: a valider\npriority: 2\narchived: true\n---\n# Tasks\n- [ ] #bug pr Export ^s9xyz\n",
		);
		expect(w.plan()).toEqual([]);
	});

	it("À reprendre: the note gets status: en cours, with nothing left to push", async () => {
		const w = world(answered("p0002", "a_reprendre", [["status", "a_valider", "en_cours"]]));
		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get(project)).toBe(
			"---\nsuivi_id: p0002\nstatus: en cours\npriority: 2\n---\n# Tasks\n- [ ] #bug pr Export ^s9xyz\n",
		);
		expect(w.plan()).toEqual([]);
	});
});

describe("Pull: an Answer on an item changed in the vault since the Push", () => {
	/** The Push modal's only entry, a conflict, set to `choice`. */
	const conflictIn = (pending: ReturnType<ReturnType<typeof world>["plan"]>, choice: "mine" | "theirs") => {
		expect(pending).toHaveLength(1);
		const c = pending[0]!;
		if (c.group !== "conflict") throw new Error(`not a conflict: ${c.group}`);
		c.choice = choice;
		return c;
	};

	it("Task À reprendre: a conflict, the edit is kept; taking Suivi's writes p0", async () => {
		const w = world(answered("t7f3a", "a_reprendre", [["priority", null, 0]]));
		w.files.set(meeting, "#task p3 Heatmap ^t7f3a\nnotes");
		expect(await w.pull()).toEqual({ applied: 0, conflicts: 1, failed: [] });
		expect(w.files.get(meeting)).toBe("#task p3 Heatmap ^t7f3a\nnotes");

		const c = conflictIn(w.plan(), "theirs");
		expect(c).toMatchObject({ local: "P3", remote: "P0 (En cours)" });
		expect(await w.push([c])).toEqual({ applied: 1, failed: [] });
		expect(w.files.get(meeting)).toBe("#task p0 Heatmap ^t7f3a\nnotes");
		expect(w.received).toEqual([]);
		expect(w.plan()).toEqual([]);
	});

	it("Task Validé, keep mine: the vault status and priority go to Suivi", async () => {
		const w = world(answered("t7f3a", "valide"));
		w.files.set(meeting, "#task p3 Heatmap ^t7f3a\nnotes");
		await w.pull();
		const c = conflictIn(w.plan(), "mine");
		expect(c).toMatchObject({ local: "P3", remote: "Terminé" });
		expect(await w.push([c])).toEqual({ applied: 1, failed: [] });
		expect(w.received).toEqual([{ op: "update", kind: "task", id: "t7f3a", fields: { status: "a_faire", priority: 3 } }]);
		expect(w.plan()).toEqual([]);
	});

	it("Project Validé on a Project put En pause: a conflict; taking Suivi's archives it", async () => {
		const w = world(answered("p0002", "valide"));
		w.files.set(project, projectNote.replace("status: a valider", "status: en pause"));
		expect(await w.pull()).toEqual({ applied: 0, conflicts: 1, failed: [] });
		expect(w.files.get(project)).toContain("status: en pause");

		const c = conflictIn(w.plan(), "theirs");
		expect(c).toMatchObject({ local: "En pause", remote: "Terminé" });
		expect(await w.push([c])).toEqual({ applied: 1, failed: [] });
		expect(w.files.get(project)).toContain("archived: true");
		expect(w.received).toEqual([]);
		expect(w.plan()).toEqual([]);
	});

	it("Project À reprendre, keep mine: the vault status goes to Suivi", async () => {
		const w = world(answered("p0002", "a_reprendre"));
		w.files.set(project, projectNote.replace("status: a valider", "status: en pause"));
		await w.pull();
		const c = conflictIn(w.plan(), "mine");
		expect(c).toMatchObject({ local: "En pause", remote: "En cours" });
		expect(await w.push([c])).toEqual({ applied: 1, failed: [] });
		expect(w.received).toEqual([{ op: "update", kind: "project", id: "p0002", fields: { status: "en_pause" } }]);
		expect(w.plan()).toEqual([]);
	});

	it("is settled by the vault once it holds Suivi's value", async () => {
		const w = world(answered("p0002", "a_reprendre"));
		w.files.set(project, projectNote.replace("status: a valider", "status: en pause"));
		await w.pull();
		w.files.set(project, projectNote.replace("status: a valider", "status: en cours"));
		expect(w.plan()).toEqual([]);
		expect(w.sync.conflicts).toEqual({});
	});
});
