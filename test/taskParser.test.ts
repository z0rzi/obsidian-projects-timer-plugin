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

	it("leaves a title alone when the token-like text is inside a word", () => {
		const task = parseOne("#task Étape2 du calcul");
		expect(task.priority).toBe(1);
		expect(task.title).toBe("Étape2 du calcul");
	});

	it("ignores an uppercase token", () => {
		const task = parseOne("#task P2 Titre");
		expect(task.priority).toBe(1);
		expect(task.title).toBe("P2 Titre");
	});

	it("ignores priorities outside p0-p5", () => {
		const task = parseOne("#task p7 Titre");
		expect(task.priority).toBe(1);
		expect(task.title).toBe("p7 Titre");
	});

	it("reads p0 as in progress", () => {
		expect(parseOne("#bug p0 Crash").priority).toBe(0);
	});

	it("reads pr as awaiting validation", () => {
		const task = parseOne("#task pr Titre");
		expect(task.status).toBe("review");
		expect(task.title).toBe("Titre");
	});

	it("does not read an uppercase PR as awaiting validation", () => {
		const task = parseOne("#task PR de refacto");
		expect(task.status).toBe("priority");
		expect(task.priority).toBe(1);
		expect(task.title).toBe("PR de refacto");
	});

	it("marks priority-token tasks with the priority status", () => {
		expect(parseOne("#task p3 Titre").status).toBe("priority");
	});
});

describe("parseTasks types", () => {
	it.each(["quick", "task", "bug", "wait"])("treats #%s lines as Tasks", (tag) => {
		expect(parseOne(`#${tag} p2 Titre`).type).toBe(tag);
	});

	it.each(["ask", "project"])("does not treat #%s lines as Tasks", (tag) => {
		expect(parseTasks([`#${tag} p2 Titre`], file, null)).toEqual([]);
	});

	it("reads a removed tag line as body text of the previous Task", () => {
		const tasks = parseTasks(["#task p1 A", "#project p2 B"], file, null);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]!.description).toBe("#project p2 B\n");
	});
});
