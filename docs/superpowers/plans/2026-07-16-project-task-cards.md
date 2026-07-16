# Project Task Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show project files as a single composite kanban card (title + up to 3 preview tasks) driven by frontmatter `priority`/`archived` and a `## Tasks` checkbox list, alongside the existing tag-based task cards.

**Architecture:** A new pure-logic module (`src/projectCards.ts`) parses a project file's frontmatter + `Tasks` heading into a `ProjectCard`. `main.ts` wires this into a new `allProjectCards` RxJS stream (mirroring the existing `allTasks` stream, kept untouched). `TasksKanbanView` merges both streams at render time, adds a composite card template, and extends its existing click/drag delegation to handle project-card checkboxes, item navigation, timer start, and priority drag-and-drop.

**Tech Stack:** TypeScript, Obsidian Plugin API, RxJS `BehaviorSubject`, jKanban.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-project-task-cards-design.md` — read it before starting; every task below implements one of its sections.
- Priority scale (verbatim from spec): `0` = `doing` column, `1`-`5` = `p1`..`p5` columns. Same scale as existing tagged tasks.
- `Tasks` heading match: exact text `Tasks` (trimmed, case-insensitive), heading level H1-H3. Section ends at the next heading whose level is `<=` the matched level, or end of file. Only the first matching heading counts.
- Checkbox extraction: only **non-indented** `- [ ]` / `- [x]` lines count as tasks. Anything indented underneath (free text or nested checkboxes) is description, never its own kanban entry.
- Preview fill algorithm: unchecked items first (in document order, up to 3), then if fewer than 3, backfill with the tail of checked items (in document order) until 3 or exhausted.
- `archived: true` (frontmatter, real boolean) hides the card unconditionally. Missing or non-numeric `priority` also hides the card. Read frontmatter via `this.app.metadataCache.getFileCache(file)?.frontmatter` (typed values), never the ad hoc string-based `parseFileProperties` — see spec's Parsing section for why.
- No new plugin settings. The "3 preview slots" count is a hardcoded constant.
- **No test framework in this repo** (confirmed: only `tsc -noEmit -skipLibCheck` + `eslint` in `npm run build`/`npm run lint`; no `*.test.ts`/`*.spec.ts` outside `node_modules`). This was an explicit, approved decision in the spec's Vérification section — do not add vitest/jest. Steps below replace automated failing/passing test cycles with:
  - `npm run build` after every step that touches `.ts` files (type-check + lint).
  - For the two pure-logic tasks (Task 1, Task 2), an ad hoc verification script run once via `npx jiti <script>` (jiti is already a devDependency, used elsewhere for TS-loading — this is not a new framework). The script is written to the scratch/tmp location given in your environment, never committed.
  - For the UI/integration tasks (Task 3 onward), manual verification in Obsidian via `npm run dev`, per the concrete scenarios in each task.
- Commit message style: short imperative sentence, capitalized, no `feat:`/`fix:` prefix — matches this repo's existing log (e.g. `Dynamic tag types`, `Add timesource markdown block processor`).
- Line numbers cited in each task reflect the file's state *before that task's own edits*. Earlier tasks (especially Task 4) insert code above later insertion points, so by the time you reach Task 5/6 the absolute line numbers will have drifted. Always locate insertion points by matching the quoted surrounding code (function name, preceding/following lines shown), not by trusting the number alone.
- The working tree currently has an unrelated, pre-existing uncommitted change to `src/types.ts` and `src/views/TasksKanbanView.ts` (tag-styling work, already includes a `project` entry in `TASKS_TYPES` with a border style). Leave it as-is and build on top of it — it is not part of this plan and should not be reverted or committed as part of these tasks.

---

### Task 1: `ProjectCard` type + Tasks-section parsing

**Files:**
- Modify: `src/types.ts:25` (insert after the `Task` type, before `export interface TimeSource`)
- Create: `src/projectCards.ts`

**Interfaces:**
- Produces: `ProjectCardItem = { text: string; line: number; checked: boolean }`, `ProjectCard = { id: number; file: TFile; priority: number; items: ProjectCardItem[] }` (from `src/types.ts`)
- Produces: `findTasksHeadingSection(lines: string[]): { start: number; end: number } | null`, `extractCheckboxItems(lines: string[], start: number, end: number): ProjectCardItem[]`, `selectPreviewItems(items: ProjectCardItem[]): ProjectCardItem[]`, `parseProjectCard(params: { file: TFile; content: string; frontmatter: Record<string, unknown> | undefined; id: number }): ProjectCard | null` (from `src/projectCards.ts`)

- [ ] **Step 1: Add the `ProjectCard` type**

In `src/types.ts`, insert after line 25 (the closing `};` of `export type Task = {...}`), before `export interface TimeSource {`:

```ts
export type ProjectCardItem = {
	text: string;
	line: number;
	checked: boolean;
};

export type ProjectCard = {
	id: number;
	file: TFile;
	priority: number;
	items: ProjectCardItem[];
};
```

- [ ] **Step 2: Create `src/projectCards.ts` with the parsing functions**

```ts
import { TFile } from "obsidian";
import { ProjectCard, ProjectCardItem } from "./types";

export function findTasksHeadingSection(
	lines: string[],
): { start: number; end: number } | null {
	const headingPattern = /^(#{1,3})\s+(.+?)\s*$/;
	let matchedLevel = -1;
	let start = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const match = line.match(headingPattern);
		if (!match) continue;

		if (start === -1) {
			if (match[2]!.toLowerCase() === "tasks") {
				matchedLevel = match[1]!.length;
				start = i + 1;
			}
			continue;
		}

		if (match[1]!.length <= matchedLevel) {
			return { start, end: i };
		}
	}

	if (start === -1) return null;
	return { start, end: lines.length };
}

export function extractCheckboxItems(
	lines: string[],
	start: number,
	end: number,
): ProjectCardItem[] {
	const checkboxPattern = /^- \[( |x|X)\] (.+)$/;
	const items: ProjectCardItem[] = [];

	for (let i = start; i < end; i++) {
		const line = lines[i] ?? "";
		const match = line.match(checkboxPattern);
		if (!match) continue;

		items.push({
			text: match[2]!.trim(),
			line: i,
			checked: match[1]!.toLowerCase() === "x",
		});
	}

	return items;
}

export function selectPreviewItems(
	items: ProjectCardItem[],
): ProjectCardItem[] {
	const unchecked = items.filter((item) => !item.checked);
	const preview = unchecked.slice(0, 3);

	if (preview.length < 3) {
		const checked = items.filter((item) => item.checked);
		const fillCount = 3 - preview.length;
		preview.push(...checked.slice(-fillCount));
	}

	return preview;
}

export function parseProjectCard(params: {
	file: TFile;
	content: string;
	frontmatter: Record<string, unknown> | undefined;
	id: number;
}): ProjectCard | null {
	const { file, content, frontmatter, id } = params;

	if (frontmatter?.archived === true) return null;

	const priority = frontmatter?.priority;
	if (typeof priority !== "number") return null;

	const lines = content.split("\n");
	const section = findTasksHeadingSection(lines);
	const items = section
		? extractCheckboxItems(lines, section.start, section.end)
		: [];

	return { id, file, priority, items: selectPreviewItems(items) };
}
```

- [ ] **Step 3: Manually verify the parsing logic**

Write this ad hoc script to your scratch directory as `verify-project-cards.ts` (do not commit it):

```ts
import { findTasksHeadingSection, extractCheckboxItems, selectPreviewItems, parseProjectCard } from "/home/zorzi/Work/VAULT/.obsidian/plugins/projects-timer/src/projectCards";

const content = `---
priority: 2
---

## Tasks

- [ ] Do something
	Description libre, ignoree.

- [ ] Second task
- [ ] Third task
- [ ] Fourth task, should not appear

#bug something unrelated

## Autre heading

- [ ] Ignored checkbox, outside Tasks section
`;

const lines = content.split("\n");
const section = findTasksHeadingSection(lines);
console.assert(section !== null, "section should be found");
console.assert(lines[section!.start]?.trim() === "", "section starts right after the heading");

const items = extractCheckboxItems(lines, section!.start, section!.end);
console.assert(items.length === 4, `expected 4 checkbox items, got ${items.length}`);
console.assert(items[0]!.text === "Do something", `unexpected text: ${items[0]!.text}`);

const preview = selectPreviewItems(items);
console.assert(preview.length === 3, `expected 3 preview items, got ${preview.length}`);
console.assert(preview[2]!.text === "Third task", `expected Third task last, got ${preview[2]!.text}`);

// All checked -> fallback to tail of checked items
const allDoneItems = [
	{ text: "a", line: 0, checked: true },
	{ text: "b", line: 1, checked: true },
	{ text: "c", line: 2, checked: true },
	{ text: "d", line: 3, checked: true },
];
const allDonePreview = selectPreviewItems(allDoneItems);
console.assert(
	allDonePreview.map((i) => i.text).join(",") === "b,c,d",
	`expected tail b,c,d, got ${allDonePreview.map((i) => i.text).join(",")}`,
);

// No Tasks heading -> card still created with empty items
const card = parseProjectCard({
	file: {} as any,
	content: "---\npriority: 1\n---\nNo tasks heading here.",
	frontmatter: { priority: 1 },
	id: 1,
});
console.assert(card !== null && card.items.length === 0, "card with no Tasks heading should have empty items");

// archived hides the card
const archivedCard = parseProjectCard({
	file: {} as any,
	content,
	frontmatter: { priority: 2, archived: true },
	id: 2,
});
console.assert(archivedCard === null, "archived project should not produce a card");

// missing priority hides the card
const noPriorityCard = parseProjectCard({
	file: {} as any,
	content,
	frontmatter: {},
	id: 3,
});
console.assert(noPriorityCard === null, "project without priority should not produce a card");

console.log("All checks passed");
```

Run: `npx jiti /tmp/verify-project-cards.ts` (adjust path to wherever you saved it)
Expected: `All checks passed` printed, no `Assertion failed` lines.

- [ ] **Step 4: Type-check and lint**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/projectCards.ts
git commit -m "Add ProjectCard type and Tasks-section parsing"
```

---

### Task 2: Checkbox and frontmatter-priority mutation helpers

**Files:**
- Modify: `src/projectCards.ts` (append)

**Interfaces:**
- Consumes: nothing new (pure string functions)
- Produces: `toggleCheckboxLine(line: string): string | null`, `setFrontmatterPriority(content: string, newPriority: number): string` (from `src/projectCards.ts`), used by Task 4 and Task 5.

- [ ] **Step 1: Add the mutation helpers**

Append to `src/projectCards.ts`:

```ts
export function toggleCheckboxLine(line: string): string | null {
	const checkboxPattern = /^- \[( |x|X)\] (.+)$/;
	const match = line.match(checkboxPattern);
	if (!match) return null;

	const newState = match[1]!.toLowerCase() === "x" ? " " : "x";
	return `- [${newState}] ${match[2]}`;
}

export function setFrontmatterPriority(
	content: string,
	newPriority: number,
): string {
	const lines = content.split("\n");
	const closingIdx = lines.indexOf("---", 1);

	for (let i = 1; i < closingIdx; i++) {
		if (lines[i]?.match(/^priority\s*:/)) {
			lines[i] = `priority: ${newPriority}`;
			break;
		}
	}

	return lines.join("\n");
}
```

`setFrontmatterPriority` assumes the file already has a frontmatter block with an existing `priority:` line — this is guaranteed by the calling context: a project card (and therefore its drag-and-drop) only ever exists once `parseProjectCard` has already confirmed `frontmatter.priority` is a number, which means the line is already there.

- [ ] **Step 2: Manually verify the mutation helpers**

Append to the same scratch script from Task 1 (`verify-project-cards.ts`), updating the import line to also pull in the two new functions:

```ts
import { findTasksHeadingSection, extractCheckboxItems, selectPreviewItems, parseProjectCard, toggleCheckboxLine, setFrontmatterPriority } from "/home/zorzi/Work/VAULT/.obsidian/plugins/projects-timer/src/projectCards";
```

And append at the end, before `console.log("All checks passed")`:

```ts
console.assert(toggleCheckboxLine("- [ ] Do something") === "- [x] Do something", "toggle unchecked -> checked");
console.assert(toggleCheckboxLine("- [x] Done") === "- [ ] Done", "toggle checked -> unchecked");
console.assert(toggleCheckboxLine("Not a checkbox") === null, "non-checkbox line returns null");

const fmContent = "---\npriority: 1\narchived: false\n---\n\n## Tasks\n";
const updated = setFrontmatterPriority(fmContent, 4);
console.assert(updated.includes("priority: 4"), "priority line updated");
console.assert(!updated.includes("priority: 1"), "old priority value gone");
console.assert(updated.includes("archived: false"), "other frontmatter lines untouched");
```

Run: `npx jiti /tmp/verify-project-cards.ts` (same path as Task 1)
Expected: `All checks passed` printed, no `Assertion failed` lines.

- [ ] **Step 3: Type-check and lint**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/projectCards.ts
git commit -m "Add checkbox and frontmatter-priority mutation helpers"
```

---

### Task 3: Wire project cards into the plugin

**Files:**
- Modify: `src/main.ts:20` (imports)
- Modify: `src/main.ts:46` (counters)
- Modify: `src/main.ts:695-698` (onLayoutReady)
- Modify: `src/main.ts:741-746` (vault event wiring, inside `onload`)
- Modify: `src/main.ts:748` (state)
- Modify: `src/main.ts:843` (after `reloadAllTasks`)

**Interfaces:**
- Consumes: `ProjectCard` (from `src/types.ts`), `parseProjectCard` (from `src/projectCards.ts`)
- Produces: `plugin.allProjectCards: BehaviorSubject<ProjectCard[]>`, used by Task 4.

- [ ] **Step 1: Import the new type and parser**

In `src/main.ts`, change line 20 from:

```ts
import { Activity, Task, TASKS_TYPES, TimeSource } from "./types";
```

to:

```ts
import { Activity, ProjectCard, Task, TASKS_TYPES, TimeSource } from "./types";
```

Then, right after that import line, add:

```ts
import { parseProjectCard } from "./projectCards";
```

- [ ] **Step 2: Add a dedicated id counter**

In `src/main.ts`, at line 46, change:

```ts
	taskCounter = 1;
```

to:

```ts
	taskCounter = 1;
	projectCardCounter = 1;
```

- [ ] **Step 3: Add the `allProjectCards` stream**

In `src/main.ts`, at line 748, change:

```ts
	allTasks = new BehaviorSubject<Task[]>([]);
```

to:

```ts
	allTasks = new BehaviorSubject<Task[]>([]);
	allProjectCards = new BehaviorSubject<ProjectCard[]>([]);
```

- [ ] **Step 4: Add `findProjectCard` and `reloadAllProjectCards`**

In `src/main.ts`, right after the closing `}` of `reloadAllTasks` (line 843) and before `onunload() {}` (line 845), insert:

```ts

	private async findProjectCard(
		file: TAbstractFile,
	): Promise<ProjectCard | null> {
		if (!(file instanceof TFile)) return null;
		if (!file.path.endsWith(".md")) return null;

		const content = await this.app.vault.cachedRead(file);
		if (!content.includes("```project")) return null;

		const frontmatter = this.app.metadataCache.getFileCache(file)
			?.frontmatter as Record<string, unknown> | undefined;

		const card = parseProjectCard({
			file,
			content,
			frontmatter,
			id: this.projectCardCounter,
		});
		if (card) this.projectCardCounter++;

		return card;
	}

	private async reloadAllProjectCards() {
		const projectFiles = this.getProjectFiles();
		const cards: ProjectCard[] = [];

		for (const file of projectFiles) {
			const card = await this.findProjectCard(file);
			if (card) cards.push(card);
		}

		this.allProjectCards.next(cards);
	}
```

- [ ] **Step 5: Load project cards at startup**

In `src/main.ts`, lines 695-698, change:

```ts
		this.app.workspace.onLayoutReady(async () => {
			await this.buildTimeSourceCache();
		});
```

Note: this block is unrelated to task loading (it only builds the time-source cache) — leave it untouched. Instead, find the second `onLayoutReady` block further down:

```ts
		this.app.workspace.onLayoutReady(() => {
			this.reloadAllTasks();
			this.updateStatusBar();
		});
```

and change it to:

```ts
		this.app.workspace.onLayoutReady(() => {
			this.reloadAllTasks();
			this.reloadAllProjectCards();
			this.updateStatusBar();
		});
```

- [ ] **Step 6: Keep project cards in sync on file create/modify**

In `src/main.ts`, right after the third `vault.on` registration (the status-bar one, lines 741-745) and before the closing `}` of `onload` (line 746), insert:

```ts

		this.app.vault.on("create", async (newFile) => {
			const card = await this.findProjectCard(newFile);
			if (card) {
				this.allProjectCards.next([...this.allProjectCards.value, card]);
			}
		});

		this.app.vault.on("modify", async (file) => {
			if (!(file instanceof TFile)) return;
			const newCard = await this.findProjectCard(file);
			const withoutFile = this.allProjectCards.value.filter(
				(card) => card.file.path !== file.path,
			);
			this.allProjectCards.next(
				newCard ? [...withoutFile, newCard] : withoutFile,
			);
		});
```

- [ ] **Step 7: Type-check and lint**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 8: Manually verify the data layer**

There's no UI yet, so verify via a temporary `console.log`: in `reloadAllProjectCards`, temporarily add `console.log(cards)` after `this.allProjectCards.next(cards)`, then:

1. Run `npm run dev` (leave it running).
2. In your Obsidian vault, open (or create) a project file under the configured "Projects location" folder, containing a `` ```project `` block, with frontmatter:
   ```yaml
   ---
   priority: 2
   ---
   ```
   and body:
   ```markdown
   ## Tasks

   - [ ] First task
   - [ ] Second task
   ```
3. Reload the plugin (or restart Obsidian) and open the developer console (Ctrl+Shift+I).
4. Confirm the logged array contains one `ProjectCard` entry with `priority: 2` and 2 items.
5. Edit the file to add `archived: true` to the frontmatter, save, and confirm a subsequent modify-triggered log (or a fresh `reloadAllProjectCards` run) no longer includes that file's card.
6. Remove the temporary `console.log` before committing.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts
git commit -m "Wire project cards into the plugin"
```

---

### Task 4: Render project cards in the kanban board

**Files:**
- Modify: `src/views/TasksKanbanView.ts:4` (imports)
- Modify: `src/views/TasksKanbanView.ts:21-44` (card templates, new helper)
- Modify: `src/views/TasksKanbanView.ts:46-58` (class fields)
- Modify: `src/views/TasksKanbanView.ts:123-125` (subscriptions)
- Modify: `src/views/TasksKanbanView.ts:128-166` (`updateBoards`)
- Modify: `src/views/TasksKanbanView.ts:168-294` (`renderBoards` — board population + styles)
- Modify: `src/views/TasksKanbanView.ts:551-563` (`onClose`)

**Interfaces:**
- Consumes: `plugin.allProjectCards: BehaviorSubject<ProjectCard[]>` (from Task 3), `ProjectCard`/`ProjectCardItem` (from `src/types.ts`)
- Produces: `projectCardHtml(card: ProjectCard): string`, `priorityToBoardId(priority: number): string`, `this.currentProjectCards: Map<number, ProjectCard>` — used by Task 5 and Task 6.

- [ ] **Step 1: Import `ProjectCard`**

In `src/views/TasksKanbanView.ts`, change line 4 from:

```ts
import { Task, TASKS_TYPES } from "../types";
```

to:

```ts
import { ProjectCard, Task, TASKS_TYPES } from "../types";
```

- [ ] **Step 2: Add the project card template and the shared priority-to-board helper**

Right after the closing `}` of `cardHtml` (line 42) and before `type BoardDef = ...` (line 44), insert:

```ts

function projectCardHtml(card: ProjectCard): string {
	const safeTitle = card.file.basename
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

	const itemsHtml = card.items
		.map((item) => {
			const safeText = item.text
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
			return `
				<div class="kanban-project-item" data-project-id="${card.id}" data-line="${item.line}">
					<span class="kanban-project-item-checkbox" data-project-id="${card.id}" data-line="${item.line}">${item.checked ? "☑" : "☐"}</span>
					<span class="kanban-project-item-text">${safeText}</span>
				</div>
			`;
		})
		.join("");

	return `
		<span>${safeTitle}</span>
		${itemsHtml}
		<span class="kanban-card-actions">
			<span class="kanban-play-btn" data-project-id="${card.id}">${PLAY_ICON}</span>
		</span>
		`;
}

function priorityToBoardId(priority: number): string {
	if (priority === 0) return "doing";
	if (priority >= 5) return "p5";
	if (priority >= 4) return "p4";
	if (priority >= 3) return "p3";
	if (priority >= 2) return "p2";
	return "p1";
}
```

- [ ] **Step 3: Track project cards alongside tasks**

In `src/views/TasksKanbanView.ts`, line 51, change:

```ts
	private currentTasks: Map<number, Task> = new Map();
```

to:

```ts
	private currentTasks: Map<number, Task> = new Map();
	private currentProjectCards: Map<number, ProjectCard> = new Map();
```

And a few lines below, change:

```ts
	private taskSub: Subscription | null = null;
```

to:

```ts
	private taskSub: Subscription | null = null;
	private projectCardSub: Subscription | null = null;
```

- [ ] **Step 4: Subscribe to `allProjectCards`**

In `src/views/TasksKanbanView.ts`, lines 123-125, change:

```ts
		this.taskSub = this.plugin.allTasks.subscribe((tasks) => {
			this.updateBoards(tasks);
		});
```

to:

```ts
		this.taskSub = this.plugin.allTasks.subscribe((tasks) => {
			this.updateBoards(tasks);
		});
		this.projectCardSub = this.plugin.allProjectCards.subscribe(() => {
			this.updateBoards(this.plugin.allTasks.getValue());
		});
```

Note: a project-card change re-renders with the full (unfiltered) task list, not whatever the search box currently has filtered — the search box only ever filters tagged tasks, and keeping it in sync with unrelated project-file edits elsewhere is out of scope (not part of the approved spec).

- [ ] **Step 5: Extend `updateBoards` to diff project cards too**

In `src/views/TasksKanbanView.ts`, replace the whole `updateBoards` method (lines 128-166):

```ts
	private updateBoards(tasks: Task[]) {
		if (this.isRendering) {
			requestAnimationFrame(() => this.updateBoards(tasks));
			return;
		}

		// Only re-render if something actually changed (by id and content hash)
		let changed = false;
		if (tasks.length !== this.currentTasks.size) {
			changed = true;
		} else {
			for (const task of tasks) {
				const existing = this.currentTasks.get(task.id);
				if (
					!existing ||
					existing.priority !== task.priority ||
					existing.title !== task.title ||
					existing.description !== task.description ||
					existing.file !== task.file ||
					existing.line !== task.line
				) {
					changed = true;
					break;
				}
			}
		}

		if (!changed) return;

		this.currentTasks.clear();
		for (const task of tasks) {
			this.currentTasks.set(task.id, task);
		}

		// Defer to avoid re-entrancy and layout thrash
		requestAnimationFrame(() => {
			this.renderBoards(tasks);
		});
	}
```

with:

```ts
	private updateBoards(tasks: Task[]) {
		if (this.isRendering) {
			requestAnimationFrame(() => this.updateBoards(tasks));
			return;
		}

		const projectCards = this.plugin.allProjectCards.getValue();

		// Only re-render if something actually changed (by id and content hash)
		let changed = false;
		if (tasks.length !== this.currentTasks.size) {
			changed = true;
		} else {
			for (const task of tasks) {
				const existing = this.currentTasks.get(task.id);
				if (
					!existing ||
					existing.priority !== task.priority ||
					existing.title !== task.title ||
					existing.description !== task.description ||
					existing.file !== task.file ||
					existing.line !== task.line
				) {
					changed = true;
					break;
				}
			}
		}

		if (!changed && projectCards.length !== this.currentProjectCards.size) {
			changed = true;
		} else if (!changed) {
			for (const card of projectCards) {
				const existing = this.currentProjectCards.get(card.id);
				if (
					!existing ||
					existing.priority !== card.priority ||
					existing.items.length !== card.items.length ||
					existing.items.some(
						(item, idx) =>
							item.text !== card.items[idx]?.text ||
							item.checked !== card.items[idx]?.checked ||
							item.line !== card.items[idx]?.line,
					)
				) {
					changed = true;
					break;
				}
			}
		}

		if (!changed) return;

		this.currentTasks.clear();
		for (const task of tasks) {
			this.currentTasks.set(task.id, task);
		}
		this.currentProjectCards.clear();
		for (const card of projectCards) {
			this.currentProjectCards.set(card.id, card);
		}

		// Defer to avoid re-entrancy and layout thrash
		requestAnimationFrame(() => {
			this.renderBoards(tasks, projectCards);
		});
	}
```

- [ ] **Step 6: Populate boards with project cards, reusing the shared priority helper**

In `src/views/TasksKanbanView.ts`, change the `renderBoards` signature (line 168) from:

```ts
	private renderBoards(tasks: Task[]) {
```

to:

```ts
	private renderBoards(tasks: Task[], projectCards: ProjectCard[]) {
```

Then replace the board-population loop (lines 231-253):

```ts
		for (const task of tasks) {
			if (task.priority === -1) continue;
			let boardId: string;
			if (task.priority === 0) boardId = "doing";
			else if (task.priority >= 5) boardId = "p5";
			else if (task.priority >= 4) boardId = "p4";
			else if (task.priority >= 3) boardId = "p3";
			else if (task.priority >= 2) boardId = "p2";
			else boardId = "p1";

			const board = boards.find((b) => b.id === boardId);
			if (!board) continue;

			board.items.push({
				id: `task-${task.id}`,
				title: cardHtml(
					String(task.id),
					task.title,
					task.description.trim(),
				),
				type: task.type,
			});
		}
```

with:

```ts
		for (const task of tasks) {
			if (task.priority === -1) continue;
			const boardId = priorityToBoardId(task.priority);

			const board = boards.find((b) => b.id === boardId);
			if (!board) continue;

			board.items.push({
				id: `task-${task.id}`,
				title: cardHtml(
					String(task.id),
					task.title,
					task.description.trim(),
				),
				type: task.type,
			});
		}

		for (const card of projectCards) {
			const boardId = priorityToBoardId(card.priority);
			const board = boards.find((b) => b.id === boardId);
			if (!board) continue;

			board.items.push({
				id: `project-${card.id}`,
				title: projectCardHtml(card),
				type: "project",
			});
		}
```

- [ ] **Step 7: Add CSS for the project card items**

In `src/views/TasksKanbanView.ts`, right after the per-type styling loop and before `styleStr += "";` (around line 289), add:

```ts
			styleStr += `
				.tasks-kanban-view-container .kanban-project-item {
					display: flex;
					align-items: center;
					gap: 4px;
					font-size: 0.85em;
					cursor: pointer;
				}
				.tasks-kanban-view-container .kanban-project-item-checkbox {
					cursor: pointer;
				}
			`;
```

- [ ] **Step 8: Unsubscribe on close**

In `src/views/TasksKanbanView.ts`, in `onClose` (lines 551-563), change:

```ts
		if (this.taskSub) {
			this.taskSub.unsubscribe();
			this.taskSub = null;
		}
```

to:

```ts
		if (this.taskSub) {
			this.taskSub.unsubscribe();
			this.taskSub = null;
		}
		if (this.projectCardSub) {
			this.projectCardSub.unsubscribe();
			this.projectCardSub = null;
		}
```

- [ ] **Step 9: Type-check and lint**

Run: `npm run build`
Expected: exits 0, no TypeScript errors. `updateBoards`'s own public signature (`tasks: Task[]`) didn't change — it now just also reads `allProjectCards` internally — so the `filterInput` handler and the `taskSub` subscription call sites need no changes. `renderBoards` is private and only ever called from `updateBoards`, which Step 5 already updated to pass both arguments.

- [ ] **Step 10: Manually verify rendering in Obsidian**

1. Run `npm run dev`, open the Tasks Kanban view in Obsidian.
2. Using the project file from Task 3's manual test (`priority: 2`, two unchecked tasks under `## Tasks`), confirm a card appears in the `p2` column showing the file's basename as title and both tasks listed.
3. Confirm the card has the thick `project`-colored border and the small "project" label in the corner (both from the pre-existing `TASKS_TYPES` entry).
4. Add a third and fourth unchecked task; confirm only the first 3 appear.
5. Check all 4 tasks as done directly in the file; confirm the card still appears (in the same priority column) showing the last 3 checked tasks.
6. Set `archived: true` in the frontmatter; confirm the card disappears.

- [ ] **Step 11: Commit**

```bash
git add src/views/TasksKanbanView.ts
git commit -m "Render project cards in the kanban board"
```

---

### Task 5: Project card interactions (checkbox toggle, open at line, timer)

**Files:**
- Modify: `src/views/TasksKanbanView.ts:6` (imports)
- Modify: `src/views/TasksKanbanView.ts` (new methods + click handler + jKanban `click` callback)

**Interfaces:**
- Consumes: `toggleCheckboxLine` (from `src/projectCards.ts`, Task 2), `this.currentProjectCards` (from Task 4)
- Produces: `updateProjectCheckbox(card: ProjectCard, line: number): Promise<void>`, `startTimerForProjectCard(card: ProjectCard): void` — used internally, and by Task 6 for consistency of pattern.

- [ ] **Step 1: Import the checkbox toggle helper**

In `src/views/TasksKanbanView.ts`, change line 6 from:

```ts
import { AddActivityModal } from "../ui/AddActivityModal";
```

to:

```ts
import { AddActivityModal } from "../ui/AddActivityModal";
import { toggleCheckboxLine } from "../projectCards";
```

- [ ] **Step 2: Add `updateProjectCheckbox`**

Right after the closing `}` of `updateTaskTag` (line 407), insert:

```ts

	private async updateProjectCheckbox(card: ProjectCard, line: number) {
		try {
			const content = await this.app.vault.read(card.file);
			const lines = content.split("\n");
			const targetLine = lines[line];
			if (!targetLine) return;

			const newLine = toggleCheckboxLine(targetLine);
			if (!newLine) return;

			lines[line] = newLine;
			await this.app.vault.modify(card.file, lines.join("\n"));
		} catch (e) {
			new Notice("Failed to update task checkbox");
		}
	}
```

- [ ] **Step 3: Add `startTimerForProjectCard`**

Right after `updateProjectCheckbox`, insert:

```ts

	private startTimerForProjectCard(card: ProjectCard) {
		const pseudoTask: Task = {
			id: -card.id,
			title: card.file.basename,
			description: "",
			file: card.file,
			projectFile: card.file,
			line: 0,
			priority: card.priority,
			type: "project",
		};
		this.startTimerForTask(pseudoTask);
	}
```

This reuses the existing timer/pause/`AddActivityModal` machinery (`startTimerForTask`, `renderTimer`) unchanged, by wrapping the project card as a `Task`-shaped object — the timer UI only ever reads `title`/`file`/`projectFile` off it.

- [ ] **Step 4: Extend the click handler**

In `src/views/TasksKanbanView.ts`, the `clickHandler` assignment (lines 355-384) currently starts with:

```ts
		this.clickHandler = (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;

			const playBtn = target.closest(
				".kanban-play-btn",
			) as HTMLElement | null;
```

Change it to insert three new branches before the existing `playBtn` branch:

```ts
		this.clickHandler = (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;

			const projectPlayBtn = target.closest(
				"span.kanban-play-btn[data-project-id]",
			) as HTMLElement | null;
			if (projectPlayBtn) {
				evt.stopPropagation();
				const cardId = projectPlayBtn.getAttribute("data-project-id");
				if (cardId) {
					const card = this.currentProjectCards.get(+cardId);
					if (card) this.startTimerForProjectCard(card);
				}
				return;
			}

			const projectCheckbox = target.closest(
				".kanban-project-item-checkbox",
			) as HTMLElement | null;
			if (projectCheckbox) {
				evt.stopPropagation();
				const cardId = projectCheckbox.getAttribute("data-project-id");
				const line = projectCheckbox.getAttribute("data-line");
				if (cardId && line) {
					const card = this.currentProjectCards.get(+cardId);
					if (card) this.updateProjectCheckbox(card, +line);
				}
				return;
			}

			const projectItem = target.closest(
				".kanban-project-item",
			) as HTMLElement | null;
			if (projectItem) {
				evt.stopPropagation();
				const cardId = projectItem.getAttribute("data-project-id");
				const line = projectItem.getAttribute("data-line");
				if (cardId && line) {
					const card = this.currentProjectCards.get(+cardId);
					if (card) {
						const leaf = this.app.workspace.getLeaf(false);
						if (leaf) {
							leaf.openFile(card.file, { eState: { line: +line } });
						}
					}
				}
				return;
			}

			const playBtn = target.closest(
				".kanban-play-btn",
			) as HTMLElement | null;
```

Leave everything from the existing `playBtn` branch onward (through the `doneBtn` branch) unchanged — the new `projectPlayBtn` selector (`span.kanban-play-btn[data-project-id]`) is more specific and matches first, so project-card play buttons never fall through to the generic `playBtn`/task-lookup branch.

- [ ] **Step 5: Handle clicks on the card background (open project file)**

In `src/views/TasksKanbanView.ts`, the jKanban `click` callback (lines 309-319) currently reads:

```ts
			click: (el: HTMLElement) => {
				const eid = el.getAttribute("data-eid");
				if (!eid) return;
				const id = parseInt(eid.replace("task-", ""), 10);
				const task = this.currentTasks.get(id);
				if (!task) return;
				const leaf = this.app.workspace.getLeaf(false);
				if (leaf) {
					leaf.openFile(task.file, { eState: { line: task.line } });
				}
			},
```

Change it to:

```ts
			click: (el: HTMLElement) => {
				const eid = el.getAttribute("data-eid");
				if (!eid) return;

				if (eid.startsWith("project-")) {
					const id = parseInt(eid.replace("project-", ""), 10);
					const card = this.currentProjectCards.get(id);
					if (!card) return;
					const leaf = this.app.workspace.getLeaf(false);
					if (leaf) leaf.openFile(card.file);
					return;
				}

				const id = parseInt(eid.replace("task-", ""), 10);
				const task = this.currentTasks.get(id);
				if (!task) return;
				const leaf = this.app.workspace.getLeaf(false);
				if (leaf) {
					leaf.openFile(task.file, { eState: { line: task.line } });
				}
			},
```

This only fires for clicks on the card background/title — clicks on items, checkboxes, and the play button are already intercepted (via `evt.stopPropagation()` in the capture-phase `clickHandler` from Step 4) before they reach this bubble-phase jKanban callback.

- [ ] **Step 6: Type-check and lint**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 7: Manually verify interactions in Obsidian**

Using the same project file as Task 4:

1. Click an item's text (not the checkbox) → confirm the file opens with the cursor/view at that task's line.
2. Click an item's checkbox → confirm the line toggles to `- [x]` in the file, the click does not navigate away, and the card updates (that item is replaced by the next unchecked one, or moves to the checked-tail fallback if none remain).
3. Click the card's play button → confirm the timer bar at the bottom starts, showing the project's file basename as the title.
4. Stop the timer past the 10-minute minimum → confirm the `AddActivityModal` opens targeting the project file, and confirm logging an activity appends to that file's `` ```project `` block as usual.
5. Click the card background (not an item or button) → confirm the project file opens (no specific line).

- [ ] **Step 8: Commit**

```bash
git add src/views/TasksKanbanView.ts
git commit -m "Add project card checkbox, navigation, and timer interactions"
```

---

### Task 6: Drag-and-drop priority update

**Files:**
- Modify: `src/views/TasksKanbanView.ts:6` (imports)
- Modify: `src/views/TasksKanbanView.ts` (new method + `dropEl` callback)

**Interfaces:**
- Consumes: `setFrontmatterPriority` (from `src/projectCards.ts`, Task 2), `this.currentProjectCards` (from Task 4)
- Produces: `updateProjectPriority(card: ProjectCard, newPriority: number): Promise<void>`

- [ ] **Step 1: Import `setFrontmatterPriority`**

In `src/views/TasksKanbanView.ts`, change:

```ts
import { toggleCheckboxLine } from "../projectCards";
```

to:

```ts
import { setFrontmatterPriority, toggleCheckboxLine } from "../projectCards";
```

- [ ] **Step 2: Add `updateProjectPriority`**

Right after the closing `}` of `startTimerForProjectCard` (added in Task 5), insert:

```ts

	private async updateProjectPriority(card: ProjectCard, newPriority: number) {
		try {
			const content = await this.app.vault.read(card.file);
			const newContent = setFrontmatterPriority(content, newPriority);
			if (newContent === content) return;

			await this.app.vault.modify(card.file, newContent);
		} catch (e) {
			new Notice("Failed to update project priority");
		}
	}
```

- [ ] **Step 3: Extend `dropEl` to branch on project cards**

In `src/views/TasksKanbanView.ts`, the `dropEl` callback (lines 320-352) currently reads:

```ts
			dropEl: async (
				el: HTMLElement,
				target: HTMLElement,
				source: HTMLElement,
				sibling: HTMLElement,
			) => {
				const targetBoard = target.closest(".kanban-board");
				const targetBoardId = targetBoard?.getAttribute("data-id");
				if (!targetBoardId) return;

				const eid = el.getAttribute("data-eid");
				if (!eid) return;
				const taskId = parseInt(eid.replace("task-", ""), 10);
				const task = this.currentTasks.get(taskId);
				if (!task) return;

				let newPriority: number;
				if (targetBoardId === "doing") {
					newPriority = 0;
				} else {
					const m = targetBoardId.match(/^p(\d)$/);
					if (m) {
						newPriority = +m[1]!;
					} else {
						return;
					}
				}

				let newTag = task.type ? `#${task.type}` : "#task";
				newTag += ` p${newPriority ?? 1}`;

				this.updateTaskTag(task, newTag);
			},
```

Change it to:

```ts
			dropEl: async (
				el: HTMLElement,
				target: HTMLElement,
				source: HTMLElement,
				sibling: HTMLElement,
			) => {
				const targetBoard = target.closest(".kanban-board");
				const targetBoardId = targetBoard?.getAttribute("data-id");
				if (!targetBoardId) return;

				const eid = el.getAttribute("data-eid");
				if (!eid) return;

				let newPriority: number;
				if (targetBoardId === "doing") {
					newPriority = 0;
				} else {
					const m = targetBoardId.match(/^p(\d)$/);
					if (m) {
						newPriority = +m[1]!;
					} else {
						return;
					}
				}

				if (eid.startsWith("project-")) {
					const cardId = parseInt(eid.replace("project-", ""), 10);
					const card = this.currentProjectCards.get(cardId);
					if (!card) return;
					this.updateProjectPriority(card, newPriority);
					return;
				}

				const taskId = parseInt(eid.replace("task-", ""), 10);
				const task = this.currentTasks.get(taskId);
				if (!task) return;

				let newTag = task.type ? `#${task.type}` : "#task";
				newTag += ` p${newPriority ?? 1}`;

				this.updateTaskTag(task, newTag);
			},
```

- [ ] **Step 4: Type-check and lint**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Manually verify drag-and-drop in Obsidian**

1. Using the same project file (currently `priority: 2`), drag its card from the `p2` column to `p4`.
2. Confirm the frontmatter now reads `priority: 4` and the card re-renders in the `p4` column.
3. Drag it to the `doing` column, confirm `priority: 0`.
4. Drag an ordinary tagged task card (e.g. a `#bug`) between columns and confirm its behavior is unchanged (still rewrites the `pN` tag, not any frontmatter).

- [ ] **Step 6: Commit**

```bash
git add src/views/TasksKanbanView.ts
git commit -m "Add project card priority drag-and-drop"
```

---

### Task 7: Final regression pass against the spec

**Files:** none (verification only, unless issues are found — fix them in the relevant file from the task above that owns that code, then commit the fix separately)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 2: Full manual scenario in Obsidian**

Using `npm run dev`, in a single project file exercise, in order:

1. No `priority` in frontmatter → confirm no card in the kanban.
2. Add `priority: 1`, no `## Tasks` heading at all → confirm a card appears in `p1` with an empty item list.
3. Add:
   ```markdown
   ## Tasks

   - [ ] Do something
   	Description libre, n'apparaît jamais dans le kanban.

   - [ ] Second task
   - [x] Already done task

   #bug error when trying to create admin account
   	-> logique tags actuelle inchangée, entrée séparée dans le kanban

   ## Autre heading

   - [ ] Simple checkbox ici → ignorée, jamais une tâche
   ```
   Confirm: the card shows exactly "Do something" and "Second task" (not "Already done task", not the checkbox under "Autre heading"); the `#bug` line still produces its own separate tagged card as before.
4. Check both "Do something" and "Second task" as done from the kanban card. Confirm the card now shows the 3 most recent checked items ("Already done task", "Do something", "Second task" — in that document order).
5. Set `archived: true`. Confirm the card disappears regardless of `priority` or task state.
6. Remove `archived`, drag the card to a different priority column, confirm the frontmatter updates and the `#bug` tagged card is unaffected by any of this.

- [ ] **Step 3: Spec cross-check**

Re-read `docs/superpowers/specs/2026-07-16-project-task-cards-design.md` top to bottom and confirm every section (Syntaxe markdown, Modèle de données, Parsing, Rendu kanban & interactions, Hors scope, Vérification) has corresponding, working behavior. Note any gap.

- [ ] **Step 4: Fix any gaps found, then commit**

If Steps 1-3 found issues, fix them in the owning file and commit with a short message describing the fix (e.g. `Fix project card checkbox line offset`). If nothing was found, no commit is needed for this task.
