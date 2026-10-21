import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { parseProjectCard } from "../src/projectCards";
import { boardSnapshot } from "../src/views/kanban/boardItems";
import { cardHtml, overrideCardHtml, projectCardHtml } from "../src/views/kanban/cardHtml";

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

describe("kanban type labels", () => {
	it("label a Tag task card with its type, in French, and leave a task card bare", () => {
		expect(cardHtml("t1", "Axe faux", "", "bug")).toMatch(/<span class="kanban-type-label" data-type="bug">BUG<\/span>/);
		expect(cardHtml("t1", "Relancer", "", "quick")).toContain('data-type="quick">RAPIDE</span>');
		expect(cardHtml("t1", "Réponse JMJ", "", "wait")).toContain('data-type="wait">ATTENTE</span>');
		expect(cardHtml("t1", "Écrire", "", "task")).not.toContain("kanban-type-label");
	});

	it("put a dot of the step's type before each step text, none for a task step", () => {
		const html = projectCardHtml(card(["- [ ] #bug Axe faux", "- [ ] #wait Réponse JMJ", "- [ ] Écrire"]), new Set());
		expect(html).toMatch(/<span class="kanban-step-dot" data-type="bug"><\/span><span class="kanban-project-item-text">[^<]*Axe faux/);
		expect(html).toMatch(/<span class="kanban-step-dot" data-type="wait"><\/span><span class="kanban-project-item-text">[^<]*Réponse JMJ/);
		expect(html.match(/kanban-step-dot/g)).toHaveLength(2);
		const widget = card(["- [ ] #quick p1 Relancer"]);
		expect(overrideCardHtml(widget, widget.overrides[0]!, new Set())).toContain('<span class="kanban-step-dot" data-type="quick"></span>');
	});
});
