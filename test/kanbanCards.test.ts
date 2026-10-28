import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { parseProjectCard } from "../src/projectCards";
import type { Task } from "../src/types";
import { boardSnapshot, fillBoards } from "../src/views/kanban/boardItems";
import { boardDrop, cardTypesCss } from "../src/views/kanban/boards";
import { cardHtml, overrideCardHtml, projectCardHtml } from "../src/views/kanban/cardHtml";
import { noteDate } from "../src/noteDate";

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
		expect(css).toMatch(/\.kanban-step-dot\[data-type="quick"\][^{]*\{\s*--type-color: #d4a72c;/);
		expect(css).not.toContain("::before");
	});

	it("colour an #idea card, its label and dots in the Idée teal, labelled IDÉE", () => {
		expect(cardHtml("t1", "Carte des flux", "", "idea")).toContain('<span class="kanban-type-label" data-type="idea">IDÉE</span>');
		const css = cardTypesCss();
		expect(css).toMatch(/\.kanban-item\[data-type="idea"\] \{[^}]*--card-color: #0f6e66;[^}]*border-left: 4px solid var\(--card-color\)/);
		expect(css).toMatch(/\.kanban-type-label\[data-type="idea"\][^{]*\{\s*--type-color: #0f6e66;/);
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

describe("kanban PZ and Rapides", () => {
	const note = (path: string, ctime = 0) => ({ path, basename: path.slice(path.lastIndexOf("/") + 1, -3), stat: { ctime } }) as TFile;
	const tagTask = (at: TFile, line: number, priority: Task["priority"], type: Task["type"] = "task", projectFile?: TFile): Task => ({
		id: `${at.path}:${line}`,
		title: `Titre ${at.basename} ${line}`,
		description: "",
		file: at,
		line,
		priority,
		type,
		raw: `#${type} Titre`,
		...(projectFile ? { projectFile } : {}),
	});
	const project = (fm: string, steps: string[]) =>
		parseProjectCard({ file, content: ["---", fm, "---", "# Tasks", ...steps].join("\n") });
	const board = (boards: ReturnType<typeof fillBoards>["boards"], id: string) => boards.find((b) => b.id === id)!;
	const ids = (boards: ReturnType<typeof fillBoards>["boards"]) => boards.flatMap((b) => b.items.map((i) => (i as { id: string }).id));

	it("hide a Tag task at PZ, a Project at PZ with its inheriting steps, and an Override at PZ", () => {
		const meeting = note("1.meetings/2026-10-13.md");
		const atPz = project("priority: pz", ["- [ ] Devis", "- [ ] pz #bug Plus tard"])!;
		expect(atPz.priority).toBe("pz");
		const atP3 = parseProjectCard({ file: note("2.projects/Autre.md"), content: "---\npriority: 3\n---\n# Tasks\n- [ ] pz Gelée\n" })!;
		const { boards } = fillBoards([tagTask(meeting, 0, "pz"), tagTask(meeting, 1, 2)], [atPz, atP3], new Map(), () => undefined);
		expect(ids(boards)).toEqual(["task-1.meetings/2026-10-13.md:1", "project-2.projects/Autre.md"]);
	});

	it("keep an Override at a rank of its own inside a Project at PZ, with the Zzz button", () => {
		const atPz = project("priority: pz", ["- [ ] Devis", "- [ ] p2 #bug Urgent", "- [ ] pr Validation"])!;
		const { boards, steps } = fillBoards([], [atPz], new Map(), () => undefined);
		expect(board(boards, "p2").items).toMatchObject([{ id: "step-0" }]);
		expect(board(boards, "pr").items).toMatchObject([{ id: "step-1" }]);
		expect(steps.get("step-0")!.item.text).toBe("Urgent");
		expect(overrideCardHtml(atPz, steps.get("step-0")!.item, new Map())).toMatch(
			/<span class="kanban-card-actions">\s*<span class="kanban-zzz-btn" data-project-id="2\.projects\/Widget\.md" data-line="5"[^>]*>Zzz<\/span>/,
		);
	});

	it("do not show a Tag task at a Priority they do not know", () => {
		const { boards } = fillBoards([tagTask(note("n.md"), 0, "px" as never)], [], new Map(), () => undefined);
		expect(ids(boards)).toEqual([]);
	});

	it("put the Rapides in a « rapides » column after « doing », oldest note first, not draggable and not a drop target", () => {
		const daily = note("1.meetings/2026-10-20.md", Date.parse("2026-10-01T10:00:00Z"));
		const older = note("1.meetings/2026-10-13 Réunion JMJ.md", Date.parse("2026-10-25T10:00:00Z"));
		const loose = note("Notes/Idées.md", Date.parse("2026-10-16T10:00:00Z"));
		const tasks = [tagTask(daily, 4, "pq", "quick"), tagTask(loose, 0, "pq", "quick"), tagTask(older, 2, "pq", "quick"), tagTask(daily, 1, "pq", "quick")];
		const { boards } = fillBoards(tasks, [], new Map(), () => undefined);
		expect(boards.map((b) => b.id)).toEqual(["pr", "doing", "rapides", "p1", "p2", "p3", "p4", "p5"]);
		expect(board(boards, "rapides").title).toBe("rapides");
		expect(board(boards, "rapides").items).toMatchObject([
			{ id: `task-${older.path}:2`, class: ["not-draggable"] },
			{ id: `task-${loose.path}:0` },
			{ id: `task-${daily.path}:1` },
			{ id: `task-${daily.path}:4` },
		]);
		for (const b of boards) expect(b.dragTo ?? []).not.toContain("rapides");
		expect(board(boards, "doing").dragTo).toEqual(["pr", "doing", "p1", "p2", "p3", "p4", "p5"]);
	});

	it("refuse a drop on the « rapides » column, give the rank of the others", () => {
		expect(boardDrop("rapides")).toBe("refused");
		expect(boardDrop("unknown")).toBe("refused");
		expect(["pr", "doing", "p1", "p5"].map(boardDrop)).toEqual(["pr", "p0", "p1", "p5"]);
	});

	it("hide the Rapides of a Project at PZ", () => {
		const atPz = project("priority: pz", [])!;
		const meeting = note("1.meetings/2026-10-13.md");
		const { boards } = fillBoards([tagTask(meeting, 0, "pq", "quick", file), tagTask(meeting, 1, "pq", "quick")], [atPz], new Map(), () => undefined);
		expect(ids(boards)).toEqual(["task-1.meetings/2026-10-13.md:1"]);
	});

	it("offer Zzz on hover on Tag task and Project cards", () => {
		expect(cardHtml("n.md:0", "Fix", "", "task")).toMatch(/<span class="kanban-zzz-btn" data-task-id="n\.md:0"[^>]*>Zzz<\/span>/);
		expect(projectCardHtml(card([]), new Map())).toMatch(/<span class="kanban-zzz-btn" data-project-id="2\.projects\/Widget\.md"[^>]*>Zzz<\/span>/);
	});
});

describe("noteDate", () => {
	it("is the YYYY-MM-DD the file name starts with, else the day the file was created", () => {
		expect(noteDate({ basename: "2026-10-13", stat: { ctime: 0 } })).toBe("2026-10-13");
		expect(noteDate({ basename: "2026-10-13 Réunion JMJ", stat: { ctime: 0 } })).toBe("2026-10-13");
		expect(noteDate({ basename: "Idées", stat: { ctime: Date.parse("2026-10-16T23:30:00Z") } })).toBe("2026-10-17");
		expect(noteDate({ basename: "2026-13-45 pas une date", stat: { ctime: Date.parse("2026-10-16T10:00:00Z") } })).toBe("2026-10-16");
	});
});
