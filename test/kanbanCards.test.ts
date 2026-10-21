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
		const projectHtml = projectCardHtml(widget, new Map());
		expect(projectHtml).toMatch(/class="kanban-project-item[^"]*"[^>]*data-type="bug"/);
		expect(projectHtml).toMatch(/class="kanban-project-item[^"]*"[^>]*data-type="task"/);
		expect(overrideCardHtml(widget, widget.overrides[0]!, new Map())).toContain('data-type="bug"');
	});

	it("repaint the board when a step's tag changes", () => {
		const before = boardSnapshot([], [card(["- [ ] Axe faux"])], new Map());
		expect(boardSnapshot([], [card(["- [ ] #bug Axe faux"])], new Map())).not.toBe(before);
	});
});

describe("kanban unread badge", () => {
	const badges = new Map([
		["p1abc", "💬 2 · P1→P2"],
		["s1xyz", "💬 1"],
	]);

	it("sits on a Project card with its item id, steps with unread entries keep a marker", () => {
		const widget = card(["- [ ] Écrire ^s1xyz", "- [ ] Relire ^s2xyz"]);
		const html = projectCardHtml(widget, badges, "p1abc");
		expect(html).toContain('<span class="suivi-badge" data-item-id="p1abc">💬 2 · P1→P2</span>');
		expect(html.match(/suivi-unread-dot/g)).toHaveLength(1);
		expect(projectCardHtml(widget, new Map(), "p1abc")).not.toContain("suivi-badge");
	});

	it("sits on a Tag task's card and on a step's own card", () => {
		expect(cardHtml("1", "Fix", "", { itemId: "t7f3a", text: "💬 1" })).toContain('data-item-id="t7f3a">💬 1<');
		const widget = card(["- [ ] p2 Écrire ^s1xyz"]);
		expect(overrideCardHtml(widget, widget.overrides[0]!, badges)).toContain('data-item-id="s1xyz">💬 1<');
	});

	it("repaints the board when a badge's text changes", () => {
		const cards = [card(["- [ ] Écrire"])];
		expect(boardSnapshot([], cards, new Map([["p1abc", "💬 1"]]))).not.toBe(
			boardSnapshot([], cards, new Map([["p1abc", "💬 2"]])),
		);
	});
});
