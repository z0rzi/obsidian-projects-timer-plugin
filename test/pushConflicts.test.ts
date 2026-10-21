import { describe, expect, it } from "vitest";
import type { PushChange, PushResult, TaskFields } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import { settleConflicts, withConflicts } from "../src/sync/conflicts";
import type { SyncState } from "../src/sync/pluginData";
import { writeRemotePriority } from "../src/sync/pullPriority";
import { planProjectPush, type PendingChange } from "../src/sync/pushPlan";
import { runPush } from "../src/sync/runPush";
import { readSharedProject, type SharedProject } from "../src/sync/sharedProject";
import { readTagTasks } from "../src/sync/sharedTask";
import { planTaskPush } from "../src/sync/taskPlan";

const now = new Date("2026-10-20T10:00:00Z");
const fields: TaskFields = { title: "Fix heatmap", type: "task", status: "a_faire", priority: 3, project_id: null, description: "" };

/** A vault where the Developer moved a Task P3 → P4 (and renamed it) while JMJ moved it to P1. */
function world() {
	const files = new Map([
		["m.md", "#task p4 Fix heatmap axis ^t7f3a\n"],
		["2.projects/A.md", "---\nsuivi_id: aaaaa\npriority: 2\n---\n"],
	]);
	const sync: SyncState = {
		pushedProjects: { aaaaa: { path: "2.projects/A.md", fields: { title: "A", description: "", status: "a_faire", priority: 4 } } },
		pushedTasks: { t7f3a: { path: "m.md", fields } },
		conflicts: {
			"t7f3a:priority": { kind: "task", id: "t7f3a", field: "priority", path: "m.md", title: "Fix heatmap", remote: 1 },
			"aaaaa:priority": { kind: "project", id: "aaaaa", field: "priority", path: "2.projects/A.md", title: "A", remote: 1 },
		},
	};
	const received: PushChange[][] = [];
	const remote: Remote = {
		async push(changes) {
			received.push(changes);
			return changes.map((c): PushResult => ({ ok: true, id: c.op === "create" ? "new" : c.id }));
		},
		async pull() {
			throw new Error("no");
		},
	};
	const plan = (): PendingChange[] => {
		const tasks = readTagTasks("m.md", files.get("m.md")!, null);
		const r = readSharedProject("2.projects/A.md", files.get("2.projects/A.md")!);
		const projects: SharedProject[] = r?.ok ? [r.project] : [];
		settleConflicts(sync, projects, tasks);
		const pending = [
			...planProjectPush(projects, sync.pushedProjects),
			...planTaskPush(tasks, {}, sync.pushedTasks, { now }).changes,
		];
		return withConflicts(pending, sync, projects, tasks);
	};
	const deps = {
		remote,
		sync,
		save: async () => {},
		writeSuiviId: async () => {},
		writeBlockId: async () => {},
		writePriority: (kind: "project" | "task", id: string, path: string, priority: number | null) =>
			writeRemotePriority(
				{
					read: async (p) => files.get(p) ?? null,
					process: async (p, edit) => void files.set(p, edit(files.get(p)!)),
					paths: () => [...files.keys()],
				},
				kind,
				id,
				path,
				priority,
			),
	};
	return { files, sync, received, plan, deps };
}

describe("Push modal: Pull conflicts", () => {
	it("shows both values instead of pushing the local one silently; other fields stay plain changes", () => {
		const w = world();
		const pending = w.plan();
		expect(pending.map((c) => c.group).sort()).toEqual(["changed", "conflict", "conflict"]);
		const changed = pending.find((c) => c.group === "changed")!;
		expect(changed.change).toEqual({ op: "update", kind: "task", id: "t7f3a", fields: { title: "Fix heatmap axis" } });
		expect(pending.filter((c) => c.group === "conflict")).toEqual([
			expect.objectContaining({ id: "aaaaa", title: "A", local: "P2", remote: "P1", choice: "mine" }),
			expect.objectContaining({ id: "t7f3a", title: "Fix heatmap axis", local: "P4", remote: "P1", choice: "mine" }),
		]);
	});

	it("keeps mine by pushing the vault value, or takes Suivi's by writing it into the vault", async () => {
		const w = world();
		const pending = w.plan();
		const taskConflict = pending.find((c) => c.group === "conflict" && c.id === "t7f3a")!;
		if (taskConflict.group !== "conflict") throw new Error();
		taskConflict.choice = "theirs";

		expect(await runPush(pending, w.deps)).toEqual({ applied: 3, failed: [] });
		expect(w.received.flat()).toContainEqual({ op: "update", kind: "project", id: "aaaaa", fields: { priority: 2 } });
		expect(w.received.flat()).not.toContainEqual(expect.objectContaining({ fields: expect.objectContaining({ priority: 4 }) }));
		expect(w.files.get("m.md")).toBe("#task p1 Fix heatmap axis ^t7f3a\n");
		expect(w.sync.conflicts).toEqual({});
		expect(w.plan()).toEqual([]);
	});

	it("drops a conflict once the vault holds Suivi's value", () => {
		const w = world();
		w.files.set("m.md", "#task p1 Fix heatmap ^t7f3a\n");
		const pending = w.plan();
		expect(pending.filter((c) => c.group === "conflict").map((c) => c.key)).toEqual(["conflict:aaaaa:priority"]);
		expect(w.sync.pushedTasks.t7f3a!.fields.priority).toBe(1);
		expect(pending.some((c) => c.change.kind === "task")).toBe(false);
	});
});
