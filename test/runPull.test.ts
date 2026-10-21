import { describe, expect, it } from "vitest";
import type { ApiEvent, TaskFields } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { withInboxNotice } from "../src/inbox/inboxNotice";
import { PULL_HANDLERS, runPull, type VaultFiles } from "../src/sync/runPull";
import { readProjectSteps } from "../src/sync/sharedTask";

const JMJ = "u-jmj";

/** An app whose log the test appends to; `pull` serves it like GET /api/events. */
function fakeApp() {
	const log: ApiEvent[] = [];
	const calls: (number | null)[] = [];
	const remote: Remote = {
		async push() {
			throw new Error("not in a Pull");
		},
		async pull(cursor) {
			calls.push(cursor);
			const events = log.filter((e) => e.id > (cursor ?? 0));
			return { events, cursor: events.at(-1)?.id ?? cursor ?? 0 };
		},
	};
	const priority = (item: string, from: number | null, to: number, actor = JMJ) =>
		log.push({
			id: log.length + 1,
			at: "2026-10-20T10:00:00.000Z",
			actor,
			type: "item.updated",
			item,
			payload: { field: "priority", from, to },
		});
	return { remote, log, calls, priority };
}

function memoryVault(initial: Record<string, string>) {
	const files = new Map(Object.entries(initial));
	const vault: VaultFiles = {
		async read(path) {
			return files.get(path) ?? null;
		},
		async process(path, edit) {
			const content = files.get(path);
			if (content === undefined) throw new Error(`no file ${path}`);
			files.set(path, edit(content));
		},
		paths: () => [...files.keys()],
	};
	return { files, vault };
}

const task = (over: Partial<TaskFields> = {}): TaskFields => ({
	title: "Fix heatmap",
	type: "task",
	status: "a_faire",
	priority: 3,
	project_id: null,
	description: "",
	...over,
});

function world(files: Record<string, string>, sync: Partial<SyncState>) {
	const app = fakeApp();
	const v = memoryVault(files);
	const state: SyncState = { pushedProjects: {}, pushedTasks: {}, ...sync };
	let saves = 0;
	const pull = (handlers?: typeof PULL_HANDLERS) =>
		runPull(
			{
				remote: app.remote,
				sync: state,
				save: async () => {
					saves++;
				},
				files: v.vault,
			},
			handlers,
		);
	return { app, files: v.files, sync: state, pull, saves: () => saves };
}

describe("Pull: Client priority changes", () => {
	it("rewrites a Tag task's token when JMJ moves it from P3 to P1", async () => {
		const w = world(
			{ "1.meetings/m.md": "#task p3 Fix heatmap ^t7f3a\n  notes\n" },
			{ pushedTasks: { t7f3a: { path: "1.meetings/m.md", fields: task() } } },
		);
		w.app.priority("t7f3a", 3, 1);

		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get("1.meetings/m.md")).toBe("#task p1 Fix heatmap ^t7f3a\n  notes\n");
		expect(w.sync.pushedTasks.t7f3a!.fields.priority).toBe(1);
		expect(w.sync.cursor).toBe(1);
		expect(w.saves()).toBe(1);
	});

	it("gives an inheriting Project step the token, making it an Override", async () => {
		const path = "2.projects/Tetris.md";
		const w = world(
			{ [path]: "---\nsuivi_id: p1abc\npriority: 3\n---\n# Tasks\n- [ ] Export CSV ^s1xyz\n" },
			{ pushedTasks: { s1xyz: { path, fields: task({ title: "Export CSV", type: "step", priority: null, project_id: "p1abc" }) } } },
		);
		w.app.priority("s1xyz", null, 2);

		expect(await w.pull()).toMatchObject({ applied: 1, failed: [] });
		expect(w.files.get(path)).toContain("- [ ] p2 Export CSV ^s1xyz\n");
		expect(readProjectSteps(path, w.files.get(path)!)).toMatchObject([{ blockId: "s1xyz", priority: 2, status: "a_faire" }]);
	});

	it("writes a Project's priority into its frontmatter, adding the key if missing", async () => {
		const files = {
			"2.projects/A.md": "---\nsuivi_id: aaaaa\npriority: 3\n---\n# Description\nx\n",
			"2.projects/B.md": "---\nsuivi_id: bbbbb\n---\n",
		};
		const fields = { title: "A", description: "x", status: "a_faire" as const, priority: 3 };
		const w = world(files, {
			pushedProjects: {
				aaaaa: { path: "2.projects/A.md", fields },
				bbbbb: { path: "2.projects/B.md", fields: { ...fields, title: "B", description: "", priority: 5 } },
			},
		});
		w.app.priority("aaaaa", 3, 1);
		w.app.priority("bbbbb", 5, 2);

		expect(await w.pull()).toMatchObject({ applied: 2, failed: [] });
		expect(w.files.get("2.projects/A.md")).toBe("---\nsuivi_id: aaaaa\npriority: 1\n---\n# Description\nx\n");
		expect(w.files.get("2.projects/B.md")).toBe("---\nsuivi_id: bbbbb\npriority: 2\n---\n");
		expect(w.sync.pushedProjects.bbbbb!.fields.priority).toBe(2);
	});

	it("changes nothing on repeated Pulls with no new events, and skips echoes and foreign items", async () => {
		const content = "#task p3 Fix heatmap ^t7f3a\n";
		const w = world({ "m.md": content }, { pushedTasks: { t7f3a: { path: "m.md", fields: task() } } });
		w.app.log.push({ id: 1, at: "", actor: "dev", type: "task.created", item: "t7f3a", payload: {} });
		w.app.priority("t7f3a", 2, 3, "dev"); // echo of our own Push
		w.app.priority("zzzzz", 3, 1); // not from this vault

		expect(await w.pull()).toEqual({ applied: 0, conflicts: 0, failed: [] });
		expect(w.sync.cursor).toBe(3);
		expect(await w.pull()).toEqual({ applied: 0, conflicts: 0, failed: [] });
		expect(w.app.calls).toEqual([null, 3]);
		expect(w.saves()).toBe(1);
		expect(w.files.get("m.md")).toBe(content);
	});

	it("keeps an unpushed local edit and records a conflict instead", async () => {
		const w = world({ "m.md": "#task p4 Fix heatmap ^t7f3a\n" }, { pushedTasks: { t7f3a: { path: "m.md", fields: task() } } });
		w.app.priority("t7f3a", 3, 1);

		expect(await w.pull()).toEqual({ applied: 0, conflicts: 1, failed: [] });
		expect(w.files.get("m.md")).toBe("#task p4 Fix heatmap ^t7f3a\n");
		expect(w.sync.pushedTasks.t7f3a!.fields.priority).toBe(3);
		expect(w.sync.conflicts).toEqual({
			"t7f3a:priority": { kind: "task", id: "t7f3a", field: "priority", path: "m.md", title: "Fix heatmap", remote: 1 },
		});

		// JMJ puts it back: no conflict left, the local edit is a plain pending change again.
		w.app.priority("t7f3a", 1, 3);
		await w.pull();
		expect(w.sync.conflicts).toEqual({});
	});

	it("finds a Task line moved to another note since the Push, and remembers where", async () => {
		const w = world(
			{ "m.md": "moved away\n", "n.md": "#task p3 Fix heatmap ^t7f3a\n" },
			{ pushedTasks: { t7f3a: { path: "m.md", fields: task() } } },
		);
		w.app.priority("t7f3a", 3, 1);

		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get("n.md")).toBe("#task p1 Fix heatmap ^t7f3a\n");
		expect(w.sync.pushedTasks.t7f3a!.path).toBe("n.md");
	});

	it("finds a renamed Project note by its suivi_id", async () => {
		const fields = { title: "A", description: "", status: "a_faire" as const, priority: 3 };
		const w = world(
			{ "2.projects/B.md": "---\nsuivi_id: aaaaa\npriority: 3\n---\n" },
			{ pushedProjects: { aaaaa: { path: "2.projects/A.md", fields } } },
		);
		w.app.priority("aaaaa", 3, 1);

		expect(await w.pull()).toMatchObject({ applied: 1, failed: [] });
		expect(w.files.get("2.projects/B.md")).toBe("---\nsuivi_id: aaaaa\npriority: 1\n---\n");
		expect(w.sync.pushedProjects.aaaaa!.path).toBe("2.projects/B.md");
	});

	it("keeps an event whose item is nowhere in the vault, reports it once and retries it at each Pull", async () => {
		const w = world({ "m.md": "#task p3 Renamed\n" }, { pushedTasks: { t7f3a: { path: "m.md", fields: task() } } });
		w.app.priority("t7f3a", 3, 1);
		const first = await w.pull();
		expect(first).toMatchObject({ applied: 0, failed: [{ title: "t7f3a" }] });
		expect(first.failed[0]!.error).toMatch(/retried/);
		expect(w.sync.cursor).toBe(1);

		// Still missing: kept, not reported again.
		expect(await w.pull()).toEqual({ applied: 0, conflicts: 0, failed: [] });

		// The line is back (block ID restored): the kept event applies.
		w.files.set("m.md", "#task p3 Renamed ^t7f3a\n");
		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get("m.md")).toBe("#task p1 Renamed ^t7f3a\n");
		expect(await w.pull()).toEqual({ applied: 0, conflicts: 0, failed: [] });
	});
});

describe("Pull: Inbox notice", () => {
	it("tells the Inbox when comments or priority changes came in, still applying the priority", async () => {
		const w = world(
			{ "m.md": "#task p3 Fix heatmap ^t7f3a\n" },
			{ pushedTasks: { t7f3a: { path: "m.md", fields: task() } } },
		);
		w.app.log.push({
			id: 1,
			at: "2026-10-20T10:00:00.000Z",
			actor: JMJ,
			type: "comment.created",
			item: "cabc",
			payload: { item_id: "t7f3a" },
		});
		w.app.priority("t7f3a", 3, 1);
		const noticed: string[] = [];
		const handlers = withInboxNotice(PULL_HANDLERS, (e) => noticed.push(e.type));

		await w.pull(handlers);
		expect(noticed).toEqual(["comment.created", "item.updated"]);
		expect(w.files.get("m.md")).toBe("#task p1 Fix heatmap ^t7f3a\n");
	});
});
