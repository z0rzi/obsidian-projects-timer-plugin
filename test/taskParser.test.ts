import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { parseTasks } from "../src/taskParser";

const file = { path: "1.meetings/2026-10-13.md", basename: "2026-10-13" } as TFile;

function parseOne(line: string) {
	const tasks = parseTasks([line], file, null);
	expect(tasks).toHaveLength(1);
	return tasks[0]!;
}

describe("parseTasks status token", () => {
	it("reads a lowercase priority token right after the tag", () => {
		const task = parseOne("#task p2 Titre");
		expect(task.priority).toBe(2);
		expect(task.title).toBe("Titre");
	});
});
