import { describe, expect, it } from "vitest";
import { itemLocation } from "../src/inbox/itemLocation";
import type { SyncState } from "../src/sync/pluginData";
import type { VaultFiles } from "../src/sync/runPull";

const files = (map: Record<string, string>): VaultFiles => ({
	read: async (path) => map[path] ?? null,
	paths: () => Object.keys(map),
	process: async () => {
		throw new Error("read only");
	},
});

const sync = {
	pushedProjects: { p1abc: { path: "2.projects/Widget.md", fields: { title: "Widget" } } },
	pushedTasks: {
		t7f3a: { path: "1.meetings/m.md", fields: { title: "Fix heatmap" } },
		s1xyz: { path: "2.projects/Widget.md", fields: { title: "Export" } },
	},
} as unknown as SyncState;

describe("item location", () => {
	const vault = files({
		"1.meetings/m.md": "# Notes\n\n#task p3 Fix heatmap ^t7f3a\n",
		"2.projects/Widget.md": "---\nsuivi_id: p1abc\n---\n# Tasks\n- [ ] Export ^s1xyz\n",
	});

	it("finds a Task's line by its block ID, wherever it moved in its file", async () => {
		expect(await itemLocation(sync, vault, { kind: "task", id: "t7f3a" })).toEqual({ path: "1.meetings/m.md", line: 2 });
		expect(await itemLocation(sync, vault, { kind: "task", id: "s1xyz" })).toEqual({ path: "2.projects/Widget.md", line: 4 });
	});

	it("opens a Project at the top of its note", async () => {
		expect(await itemLocation(sync, vault, { kind: "project", id: "p1abc" })).toEqual({ path: "2.projects/Widget.md", line: 0 });
	});

	it("is null for items not from this vault or whose line is gone", async () => {
		expect(await itemLocation(sync, vault, { kind: "task", id: "zzzzz" })).toBeNull();
		const gone = files({ "1.meetings/m.md": "#task p3 Fix heatmap\n" });
		expect(await itemLocation(sync, gone, { kind: "task", id: "t7f3a" })).toBeNull();
	});

	it("is null for an entry without an item, instead of throwing", async () => {
		expect(await itemLocation(sync, vault, undefined)).toBeNull();
	});
});
