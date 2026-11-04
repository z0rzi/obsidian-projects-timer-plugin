import { describe, expect, it } from "vitest";
import { indentEdits, isUnderTask } from "../src/editor/taskBodyIndent";

const note = [
	"# Triage", // 0
	"#task pz Intégrer ^ilu2l", // 1
	"  [[Maintenance]]", // 2
	"", // 3
	"\tIntégrer une valeur", // 4
	"", // 5
	"---", // 6
	"- liste", // 7
	"#done 2026-11-04 Fait", // 8
	"", // 9
];

describe("isUnderTask", () => {
	it("holds for the body of a Task, blank lines between its paragraphs included", () => {
		expect([2, 3, 4, 5].map((i) => isUnderTask(note, i))).toEqual([true, true, true, true]);
	});

	it("doesn't hold for the Task line itself, nor past the next line at indent zero", () => {
		expect([0, 1, 6, 7].map((i) => isUnderTask(note, i))).toEqual([false, false, false, false]);
	});

	it("holds for the blank line right under a #done line", () => {
		expect(isUnderTask(note, 9)).toBe(true);
	});
});

describe("indentEdits", () => {
	it("Tab puts two spaces at the start of the cursor's line, even blank", () => {
		expect(indentEdits(note, 3, 3, 1)).toEqual([{ line: 3, remove: 0, insert: "  " }]);
	});

	it("Tab over several lines indents the non-blank ones", () => {
		expect(indentEdits(note, 2, 4, 1)).toEqual([
			{ line: 2, remove: 0, insert: "  " },
			{ line: 4, remove: 0, insert: "  " },
		]);
	});

	it("Shift+Tab takes off a leading tab or up to two spaces", () => {
		expect(indentEdits(note, 2, 4, -1)).toEqual([
			{ line: 2, remove: 2, insert: "" },
			{ line: 4, remove: 1, insert: "" },
		]);
	});

	it("leaves the editor's own Tab when a line isn't under a Task", () => {
		expect(indentEdits(note, 1, 2, 1)).toBeNull();
		expect(indentEdits(note, 7, 7, 1)).toBeNull();
	});
});
