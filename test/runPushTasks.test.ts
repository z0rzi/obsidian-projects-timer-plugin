import { describe, expect, it } from "vitest";
import type { PushChange, PushResult } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { planProjectPush } from "../src/sync/pushPlan";
import { runPush } from "../src/sync/runPush";
import type { SharedProject } from "../src/sync/sharedProject";
import type { LocalTask } from "../src/sync/sharedTask";
import { planTaskPush, type ProjectLinks } from "../src/sync/taskPlan";

const now = new Date("2026-10-20T10:00:00Z");

/** An app that numbers new items and rejects Tasks titled "Refusé". */
function fakeApp() {
	const received: PushChange[][] = [];
	let next = 0;
	const remote: Remote = {
		async push(changes) {
			received.push(changes);
			return changes.map((c): PushResult => {
				if (c.kind === "task" && c.op !== "archive" && c.fields.title === "Refusé") return { ok: false, error: "Titre refusé" };
				return { ok: true, id: c.op === "create" ? `id${next++}` : c.id };
			});
		},
	};
	return { remote, received };
}

const line = (over: Partial<LocalTask>): LocalTask => ({
	path: "m.md",
	line: 0,
	raw: "#task p2 Widget",
	projectPath: null,
	title: "Widget",
	type: "task",
	status: "a_faire",
	priority: 2,
	...over,
});

function vault(tasks: LocalTask[], projects: SharedProject[] = []) {
	const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
	const blockIds: Record<string, string> = {};
	const suiviIds: Record<string, string> = {};
	const links = (): ProjectLinks =>
		Object.fromEntries(
			projects.map((p) => [p.path, { title: p.fields.title, ...(suiviIds[p.path] ? { id: suiviIds[p.path] } : {}) }]),
		);
	const localTasks = () => tasks.map((t) => (blockIds[t.raw] ? { ...t, blockId: blockIds[t.raw] } : t));
	const localProjects = () => projects.map((p) => ({ ...p, suiviId: suiviIds[p.path] }));
	return {
		sync,
		blockIds,
		plan: () => {
			const t = planTaskPush(localTasks(), links(), sync.pushedTasks, { now, doneHistory: sync.doneHistory });
			return { changes: [...planProjectPush(localProjects(), sync.pushedProjects), ...t.changes], history: t.history };
		},
		deps: (remote: Remote, doneHistory: string[] = []) => ({
			remote,
			sync,
			save: async () => {},
			doneHistory,
			writeSuiviId: async (path: string, id: string) => {
				suiviIds[path] = id;
			},
			writeBlockId: async (_path: string, ref: { raw: string }, id: string) => {
				blockIds[ref.raw] = id;
			},
		}),
	};
}

const tetris: SharedProject = {
	path: "2.projects/Tetris.md",
	archived: false,
	fields: { title: "Tetris", description: "", status: "a_faire", priority: 3 },
};

describe("runPush with Tasks", () => {
	it("creates a Task, writes its block ID and leaves nothing pending", async () => {
		const app = fakeApp();
		const v = vault([line({})]);

		expect(await runPush(v.plan().changes, v.deps(app.remote))).toEqual({ applied: 1, failed: [] });

		expect(v.blockIds).toEqual({ "#task p2 Widget": "id0" });
		expect(v.plan().changes).toEqual([]);
	});

	it("pushes a new Project before its Tasks and links them to its new id", async () => {
		const app = fakeApp();
		const v = vault([line({ projectPath: tetris.path })], [tetris]);

		expect(await runPush(v.plan().changes, v.deps(app.remote))).toEqual({ applied: 2, failed: [] });

		expect(app.received).toMatchObject([
			[{ op: "create", kind: "project" }],
			[{ op: "create", kind: "task", fields: { project_id: "id0" } }],
		]);
		expect(v.plan().changes).toEqual([]);
	});

	it("keeps a Task pending when its new Project was not pushed", async () => {
		const app = fakeApp();
		const v = vault([line({ projectPath: tetris.path })], [tetris]);
		const onlyTask = v.plan().changes.filter((c) => c.change.kind === "task");

		const outcome = await runPush(onlyTask, v.deps(app.remote));

		expect(outcome.applied).toBe(0);
		expect(outcome.failed).toMatchObject([{ title: "Widget", error: expect.stringContaining("Tetris") }]);
		expect(app.received).toEqual([]);
		expect(v.plan().changes).toHaveLength(2);
	});

	it("keeps a rejected Task pending", async () => {
		const app = fakeApp();
		const v = vault([line({ title: "Refusé", raw: "#task Refusé" }), line({})]);

		const outcome = await runPush(v.plan().changes, v.deps(app.remote));

		expect(outcome).toEqual({ applied: 1, failed: [{ title: "Refusé", error: "Titre refusé" }] });
		expect(v.plan().changes).toMatchObject([{ group: "new", title: "Refusé" }]);
	});

	it("remembers the undated done items left out of the first Push", async () => {
		const app = fakeApp();
		const old = line({ raw: "- [x] Ancienne", title: "Ancienne", type: "step", status: "termine", priority: null });
		const v = vault([line({}), old]);
		const first = v.plan();

		await runPush(first.changes, v.deps(app.remote, first.history));

		expect(v.sync.doneHistory).toEqual(["m.md\n- [x] Ancienne"]);
		expect(v.plan().changes).toEqual([]);
	});
});
