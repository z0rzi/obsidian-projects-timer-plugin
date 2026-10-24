import { describe, expect, it } from "vitest";
import { itemLocation } from "../src/inbox/itemLocation";
import type { VaultFiles } from "../src/sync/runPull";

const files = (map: Record<string, string>): VaultFiles => ({
	read: async (path) => map[path] ?? null,
	paths: () => Object.keys(map),
	process: async () => {
		throw new Error("read only");
	},
	processFrontMatter: async () => {
		throw new Error("read only");
	},
});

describe("item location", () => {
	const vault = files({
		"1.meetings/m.md": "# Notes\n\n#task p3 Fix heatmap ^t7f3a\n",
		"2.projects/Widget.md": "---\nsuivi_id: p1abc\n---\n# Tasks\n- [ ] Export ^s1xyz\n",
	});

	it("finds a Task's line by its block ID, with or without the base's path as a hint", async () => {
		expect(await itemLocation(vault, { kind: "task", id: "t7f3a" }, "1.meetings/m.md")).toEqual({ path: "1.meetings/m.md", line: 2 });
		expect(await itemLocation(vault, { kind: "task", id: "s1xyz" })).toEqual({ path: "2.projects/Widget.md", line: 4 });
	});

	it("finds an Item whose note moved since its base", async () => {
		expect(await itemLocation(vault, { kind: "task", id: "t7f3a" }, "old/m.md")).toEqual({ path: "1.meetings/m.md", line: 2 });
	});

	it("opens a Project at the top of the note with its suivi_id", async () => {
		expect(await itemLocation(vault, { kind: "project", id: "p1abc" })).toEqual({ path: "2.projects/Widget.md", line: 0 });
	});

	it("is null for items in no note", async () => {
		expect(await itemLocation(vault, { kind: "task", id: "zzzzz" })).toBeNull();
		const gone = files({ "1.meetings/m.md": "#task p3 Fix heatmap\n" });
		expect(await itemLocation(gone, { kind: "task", id: "t7f3a" }, "1.meetings/m.md")).toBeNull();
	});

	it("is null for an entry without an item, instead of throwing", async () => {
		expect(await itemLocation(vault, undefined)).toBeNull();
	});
});
