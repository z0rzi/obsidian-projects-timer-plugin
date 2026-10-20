import { describe, expect, it } from "vitest";
import { commentTargetAt } from "../src/comments/commentTarget";

const project = [
	"---",
	"priority: 2",
	"suivi_id: p1abc",
	"---",
	"# Description",
	"Widget saison",
	"",
	"# Tasks",
	"---",
	"- [ ] Export CSV ^s9xyz",
	"- [ ] Pas encore poussée",
	"",
	"#task p1 Fix heatmap ^t7f3a",
	"Notes privées sur la heatmap",
	"suite des notes",
	"",
	"Texte libre",
].join("\n");

const at = (line: number, content = project, path = "2.projects/Widget.md") => commentTargetAt(path, content, line);

describe("comment target under the cursor", () => {
	it("is the pushed Tag task on the cursor line", () => {
		expect(at(12)).toEqual({ kind: "task", id: "t7f3a", title: "Fix heatmap" });
	});

	it("stays on the Tag task while the cursor is in its body, up to the blank line", () => {
		expect(at(13)).toEqual({ kind: "task", id: "t7f3a", title: "Fix heatmap" });
		expect(at(14)).toEqual({ kind: "task", id: "t7f3a", title: "Fix heatmap" });
		expect(at(16)).toEqual({ kind: "project", id: "p1abc", title: "Widget" });
	});

	it("is the pushed Project step on the cursor line", () => {
		expect(at(9)).toEqual({ kind: "task", id: "s9xyz", title: "Export CSV" });
	});

	it("falls back to the Project of the note elsewhere, including on unpushed lines", () => {
		expect(at(0)).toEqual({ kind: "project", id: "p1abc", title: "Widget" });
		expect(at(10)).toEqual({ kind: "project", id: "p1abc", title: "Widget" });
	});

	it("is nothing in a note that isn't a pushed Project, away from pushed Tasks", () => {
		const meeting = "# Réunion\n#task p2 Appeler JMJ ^t1aaa\n\n#task p3 Pas poussée\n";
		expect(at(1, meeting, "1.meetings/2026-10-13.md")).toEqual({ kind: "task", id: "t1aaa", title: "Appeler JMJ" });
		expect(at(3, meeting, "1.meetings/2026-10-13.md")).toBeNull();
		expect(at(0, meeting, "1.meetings/2026-10-13.md")).toBeNull();
	});

	it("skips private Projects and #private Tasks", () => {
		expect(at(0, "---\nprive: true\nsuivi_id: p2xyz\n---\n")).toBeNull();
		expect(at(0, "#task p1 Secret #private ^t2bbb\n", "notes.md")).toBeNull();
	});
});
