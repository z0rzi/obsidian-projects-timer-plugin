import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { parseProjectCard } from "../src/projectCards";
import type { Task } from "../src/types";
import { boardSnapshot, fillBoards } from "../src/views/kanban/boardItems";
import { cardTypesCss } from "../src/views/kanban/boards";
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

describe("kanban Project cards", () => {
	it("put a priority: pr Project in the to validate column, and repaint when it gets there", () => {
		const atPr = parseProjectCard({ file, content: "---\npriority: pr\n---\n# Tasks\n" })!;
		const { boards } = fillBoards([], [atPr], new Map(), () => undefined);
		expect(boards.find((b) => b.id === "pr")!.items).toMatchObject([{ id: "project-2.projects/Widget.md" }]);
		expect(boardSnapshot([], [atPr], new Map())).not.toBe(boardSnapshot([], [card([])], new Map()));
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
		expect(cardHtml("1", "Fix", "", "task", { itemId: "t7f3a", text: "💬 1" })).toContain('data-item-id="t7f3a">💬 1<');
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

describe("kanban type labels", () => {
	it("label a Tag task card with its type, in French, and leave a task card bare", () => {
		expect(cardHtml("t1", "Axe faux", "", "bug")).toMatch(/<span class="kanban-type-label" data-type="bug">BUG<\/span>/);
		expect(cardHtml("t1", "Relancer", "", "quick")).toContain('data-type="quick">RAPIDE</span>');
		expect(cardHtml("t1", "Réponse JMJ", "", "wait")).toContain('data-type="wait">ATTENTE</span>');
		expect(cardHtml("t1", "Écrire", "", "task")).not.toContain("kanban-type-label");
	});

	it("label an Override card with its step's type, and leave a task step's card bare", () => {
		const widget = card(["- [ ] #bug p1 Axe faux", "- [ ] p2 Écrire"]);
		const [bug, task] = widget.overrides;
		expect(overrideCardHtml(widget, bug!, new Map())).toContain('<span class="kanban-type-label" data-type="bug">BUG</span>');
		expect(overrideCardHtml(widget, task!, new Map())).not.toContain("kanban-type-label");
	});

	it("put a dot of the step's type before each step text, grey for a task step", () => {
		const html = projectCardHtml(card(["- [ ] #bug Axe faux", "- [ ] #wait Réponse JMJ", "- [ ] Écrire"]), new Map());
		expect(html).toMatch(/<span class="kanban-step-dot" data-type="bug"><\/span><span class="kanban-project-item-text">[^<]*Axe faux/);
		expect(html).toMatch(/<span class="kanban-step-dot" data-type="wait"><\/span><span class="kanban-project-item-text">[^<]*Réponse JMJ/);
		expect(html).toMatch(/<span class="kanban-step-dot" data-type="task"><\/span><span class="kanban-project-item-text">[^<]*Écrire/);
		// Grey for the dot only: a task card keeps no card colour, so its title is not tinted.
		expect(readFileSync(new URL("../styles.css", import.meta.url), "utf8")).toMatch(
			/\.kanban-step-dot \{[^}]*background: var\(--type-color, #8c959f\);/,
		);
		expect(cardTypesCss()).not.toMatch(/data-type="task"\][^{]*\{[^}]*--(card|type)-color/);
		const widget = card(["- [ ] #quick p1 Relancer"]);
		expect(overrideCardHtml(widget, widget.overrides[0]!, new Map())).toContain('<span class="kanban-step-dot" data-type="quick"></span>');
	});

	it("repaint the board when a Tag task's tag changes", () => {
		const task = (type: Task["type"]): Task => ({
			id: "Notes.md:0",
			title: "Axe faux",
			description: "",
			file,
			line: 0,
			priority: 2,
			type,
			raw: `#${type} p2 Axe faux`,
		});
		expect(boardSnapshot([task("bug")], [], new Map())).not.toBe(boardSnapshot([task("task")], [], new Map()));
	});

	it("colour labels and dots from the type palette, with no faint corner word left", () => {
		const css = cardTypesCss();
		expect(css).toMatch(/\.kanban-type-label\[data-type="bug"\][^{]*\{\s*--type-color: #b82626;/);
		expect(css).toMatch(/\.kanban-step-dot\[data-type="quick"\][^{]*\{\s*--type-color: #f7d522;/);
		expect(css).not.toContain("::before");
	});
});

describe("kanban card escaping", () => {
	it("escapes & < > \" ' in text and attributes", () => {
		const html = cardHtml('1"x', "Tom & <Jerry>", "it's \"ok\"", "task", { itemId: 'a"b', text: "💬 1" });
		expect(html).toContain("Tom &amp; &lt;Jerry&gt;");
		expect(html).toContain("it&#39;s &quot;ok&quot;");
		expect(html).toContain('data-item-id="a&quot;b"');
		expect(html).toContain('data-task-id="1&quot;x"');
	});
});
