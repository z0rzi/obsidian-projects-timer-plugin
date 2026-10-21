import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { parseProjectCard } from "../src/projectCards";
import { boardSnapshot } from "../src/views/kanban/boardItems";
import { overrideCardHtml, projectCardHtml } from "../src/views/kanban/cardHtml";

const file = { path: "2.projects/Widget.md", basename: "Widget" } as TFile;
const card = (steps: string[]) =>
	parseProjectCard({ file, content: ["---", "priority: 3", "---", "# Tasks", ...steps].join("\n") })!;

describe("kanban step lines", () => {
	it("carry the step's type on its line of the Project card and on its own Override card", () => {
		const widget = card(["- [ ] #bug p1 Axe faux", "- [ ] Écrire"]);
		const projectHtml = projectCardHtml(widget, new Set());
		expect(projectHtml).toMatch(/class="kanban-project-item[^"]*"[^>]*data-type="bug"/);
		expect(projectHtml).toMatch(/class="kanban-project-item[^"]*"[^>]*data-type="task"/);
		expect(overrideCardHtml(widget, widget.overrides[0]!, new Set())).toContain('data-type="bug"');
	});

	it("repaint the board when a step's tag changes", () => {
		const before = boardSnapshot([], [card(["- [ ] Axe faux"])], new Set());
		expect(boardSnapshot([], [card(["- [ ] #bug Axe faux"])], new Set())).not.toBe(before);
	});
});
