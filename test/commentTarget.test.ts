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
	"  Notes sur la heatmap",
	"",
	"  suite des notes",
	"Texte libre",
].join("\n");

const at = (line: number, content = project, path = "2.projects/Widget.md") => commentTargetAt(path, content, line);

describe("comment target under the cursor", () => {
	it("is the pushed Tag task on the cursor line", () => {
		expect(at(12)).toEqual({ kind: "task", id: "t7f3a", title: "Fix heatmap" });
	});

	it("stays on the Tag task while the cursor is in its indented body, blank lines included", () => {
		expect(at(13)).toEqual({ kind: "task", id: "t7f3a", title: "Fix heatmap" });
		expect(at(14)).toEqual({ kind: "task", id: "t7f3a", title: "Fix heatmap" });
		expect(at(15)).toEqual({ kind: "task", id: "t7f3a", title: "Fix heatmap" });
		expect(at(16)).toEqual({ kind: "project", id: "p1abc", title: "Widget" });
	});

	it("doesn't take a block id outside the app's format for an app id", () => {
		expect(at(0, "#task p1 Fix heatmap ^abc123", "notes.md")).toBeNull();
		expect(at(9, project.replace("^s9xyz", "^copied-link"))).toEqual({ kind: "project", id: "p1abc", title: "Widget" });
	});

	it("covers the whole body when it starts after a blank line", () => {
		const note = "#task p1 Fix heatmap ^t7f3a\n\n  corps\n  fin\nTexte libre";
		expect(at(3, note, "notes.md")).toEqual({ kind: "task", id: "t7f3a", title: "Fix heatmap" });
		expect(at(4, note, "notes.md")).toBeNull();
	});

	it("is the pushed Project step on the cursor line or in its indented body", () => {
		expect(at(9)).toEqual({ kind: "task", id: "s9xyz", title: "Export CSV" });
		const withBody = project.replace("- [ ] Export CSV ^s9xyz", "- [ ] Export CSV ^s9xyz\n  détail de l'export");
		expect(at(10, withBody)).toEqual({ kind: "task", id: "s9xyz", title: "Export CSV" });
		expect(at(11, withBody)).toEqual({ kind: "project", id: "p1abc", title: "Widget" });
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
