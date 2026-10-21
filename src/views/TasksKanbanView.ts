import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from "obsidian";
import "jkanban";
import type ProjectsTimerPlugin from "../main";
import type { ProjectCard, Task } from "../types";
import { Subscription } from "rxjs";
import { localDay } from "../localDate";
import { boardIdToToken, cardTypesCss } from "./kanban/boards";
import { boardSnapshot, fillBoards, type StepRef } from "./kanban/boardItems";
import { CardWrites } from "./kanban/cardWrites";
import { isDroppedOnCard } from "./kanban/dropTarget";
import { TimerBar } from "./kanban/timerBar";

declare global {
	interface Window {
		jKanban: new (options: any) => any;
	}
}

export const TASKS_KANBAN_VIEW_TYPE = "tasks-kanban-view";

let idCounter = 0;

/**
 * Kanban of Tag tasks, Project cards and Overrides by status (À valider,
 * doing, P1–P5). Dragging a card rewrites its line's token (or a Project's
 * frontmatter priority); cards start the footer timer.
 */
export class TasksKanbanView extends ItemView {
	private kanbanInstance: any;
	private rootId: string;
	private clickHandler: ((evt: MouseEvent) => void) | null = null;
	private taskSub: Subscription | null = null;
	private projectCardSub: Subscription | null = null;
	private inboxUnsub: (() => void) | null = null;
	private currentTasks: Map<string, Task> = new Map();
	private currentProjectCards: Map<string, ProjectCard> = new Map();
	/** Override cards by jKanban id. */
	private currentSteps: Map<string, StepRef> = new Map();
	private lastPointer: { x: number; y: number } | null = null;
	private isRendering = false;
	private lastSnapshot: string | null = null;
	private timer: TimerBar | null = null;
	private readonly writes: CardWrites;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ProjectsTimerPlugin,
	) {
		super(leaf);
		this.rootId = `kanban-root-${++idCounter}`;
		this.writes = new CardWrites(this.app);
	}

	getViewType(): string {
		return TASKS_KANBAN_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Tasks Kanban";
	}

	getIcon(): string {
		return "square-kanban";
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement | undefined;
		if (!container) return;
		container.empty();
		container.addClass("tasks-kanban-view-container");
		container.style.display = "flex";
		container.style.flexDirection = "column";

		const searchEl = container.createDiv("kanban-timer-header");
		searchEl.style.width = "100%";
		searchEl.style.padding = "0px 10px";
		const filterInput = searchEl.createEl("input");
		filterInput.style.width = "100%";
		filterInput.type = "text";
		filterInput.placeholder = "Filter tasks";
		filterInput.addEventListener("input", () => {
			const search = filterInput.value.toLowerCase();
			const allTasks = this.plugin.allTasks.getValue();
			if (!search.trim()) {
				this.updateBoards(allTasks);
				return;
			}
			this.updateBoards(
				allTasks.filter(
					(task) => task.title.toLowerCase().includes(search) || task.description.toLowerCase().includes(search),
				),
			);
		});

		const kanbanContainer = container.createDiv("kanban-container-wrapper");
		kanbanContainer.style.flexGrow = "1";
		kanbanContainer.style.width = "100%";
		kanbanContainer.style.overflowY = "auto";
		kanbanContainer.style.overflowX = "hidden";

		const kanbanRoot = kanbanContainer.createDiv();
		kanbanRoot.id = this.rootId;

		const footerEl = container.createDiv("kanban-timer-footer");
		footerEl.style.flexGrow = "0";
		footerEl.style.width = "100%";
		this.timer = new TimerBar(footerEl, {
			app: this.app,
			addActivity: (file, duration, description) => void this.plugin.addActivityToFile(file, duration, description),
			parseTime: (raw) => this.plugin.parseTime(raw),
			showPlayButtons: (show) =>
				this.containerEl
					.querySelectorAll<HTMLElement>(".kanban-play-btn")
					.forEach((btn) => (btn.style.display = show ? "flex" : "none")),
		});

		// jKanban drops into boards, not onto cards: remember where the pointer was.
		this.registerDomEvent(document, "mousemove", (evt) => {
			this.lastPointer = { x: evt.clientX, y: evt.clientY };
		});

		this.taskSub = this.plugin.allTasks.subscribe((tasks) => this.updateBoards(tasks));
		this.projectCardSub = this.plugin.allProjectCards.subscribe(() => this.redraw());
		this.inboxUnsub = this.plugin.onInboxChange(() => this.redraw());
	}

	private redraw() {
		this.updateBoards(this.plugin.allTasks.getValue());
	}

	/** Draws again even if nothing changed (jKanban already moved a card the vault refused). */
	private putBack() {
		this.lastSnapshot = null;
		this.redraw();
	}

	/** App ids of the items with an unread Inbox entry (card dots). */
	private unreadItems(): Set<string> {
		return new Set(this.plugin.unreadByItem().keys());
	}

	private updateBoards(tasks: Task[]) {
		if (this.isRendering) {
			requestAnimationFrame(() => this.updateBoards(tasks));
			return;
		}

		const projectCards = this.plugin.allProjectCards.getValue();

		// Only re-render if the board content actually changed
		const snapshot = boardSnapshot(tasks, projectCards, this.unreadItems());
		if (snapshot === this.lastSnapshot) return;
		this.lastSnapshot = snapshot;

		this.currentTasks = new Map(tasks.map((t) => [t.id, t]));
		this.currentProjectCards = new Map(projectCards.map((c) => [c.id, c]));

		// Defer to avoid re-entrancy and layout thrash
		requestAnimationFrame(() => this.renderBoards(tasks, projectCards));
	}

	private renderBoards(tasks: Task[], projectCards: ProjectCard[]) {
		const rootEl = document.getElementById(this.rootId);
		if (!rootEl) return;

		this.isRendering = true;
		this.kanbanInstance = null;
		if (this.clickHandler) {
			rootEl.removeEventListener("click", this.clickHandler, true);
			this.clickHandler = null;
		}
		rootEl.innerHTML = "";

		const filled = fillBoards(tasks, projectCards, this.unreadItems(), (path) => this.plugin.suiviIdOf(path));
		const boards = filled.boards;
		this.currentSteps = filled.steps;

		// Per-type card styles (static ones are in styles.css).
		setTimeout(() => document.getElementById(this.rootId)?.createEl("style")?.setText(cardTypesCss()), 10);

		this.kanbanInstance = new window.jKanban({
			element: `#${this.rootId}`,
			gutter: "10px",
			widthBoard: "260px",
			responsivePercentage: false,
			dragItems: true,
			dragBoards: false,
			boards: boards.map((b) => ({ id: b.id, title: b.title, class: b.class, item: b.items })),
			click: (el: HTMLElement) => this.openCard(el.getAttribute("data-eid")),
			dropEl: (el: HTMLElement, target: HTMLElement) => this.dropCard(el, target),
		});

		this.clickHandler = (evt) => this.onCardButton(evt);
		rootEl.addEventListener("click", this.clickHandler, true);

		// Allow next update after a tick
		requestAnimationFrame(() => {
			this.isRendering = false;
		});
	}

	private openCard(eid: string | null) {
		if (!eid) return;
		const step = this.currentSteps.get(eid);
		if (step) return this.openFileAtLine(step.card.file, step.item.line);
		if (eid.startsWith("project-")) {
			const card = this.currentProjectCards.get(eid.replace("project-", ""));
			if (card) this.openFileAtLine(card.file);
			return;
		}
		const task = this.currentTasks.get(eid.replace("task-", ""));
		if (task) this.openFileAtLine(task.file, task.line);
	}

	private async dropCard(el: HTMLElement, target: HTMLElement) {
		const targetBoardId = target.closest(".kanban-board")?.getAttribute("data-id");
		const eid = el.getAttribute("data-eid");
		if (!targetBoardId || !eid) return;

		const step = this.currentSteps.get(eid);
		if (step) {
			const backOnProject = isDroppedOnCard(el, `project-${step.card.id}`, this.lastPointer);
			const token = backOnProject ? null : boardIdToToken(targetBoardId);
			if (!backOnProject && !token) return;
			if (!(await this.writes.stepToken(step.card.file, step.item, token))) this.putBack();
			return;
		}

		const token = boardIdToToken(targetBoardId);
		if (!token) return;

		if (eid.startsWith("project-")) {
			const card = this.currentProjectCards.get(eid.replace("project-", ""));
			if (!card) return;
			// Projects have no À valider status: put the card back.
			if (token === "pr") return this.putBack();
			await this.writes.projectPriority(card, +token.slice(1));
			return;
		}

		const task = this.currentTasks.get(eid.replace("task-", ""));
		if (task) await this.writes.taskTag(task, `${task.type ? `#${task.type}` : "#task"} ${token}`);
	}

	/** Play, done, step checkbox and step clicks inside cards (before jKanban's own click). */
	private onCardButton(evt: MouseEvent) {
		const target = evt.target as HTMLElement;
		const hit = (selector: string) => target.closest<HTMLElement>(selector);
		const cardOf = (el: HTMLElement) => this.currentProjectCards.get(el.getAttribute("data-project-id") ?? "");
		const taskOf = (el: HTMLElement) => this.currentTasks.get(el.getAttribute("data-task-id") ?? "");

		const projectPlay = hit("span.kanban-play-btn[data-project-id]");
		const checkbox = hit(".kanban-project-item-checkbox");
		const stepItem = hit(".kanban-project-item");
		const play = hit(".kanban-play-btn");
		const done = hit(".kanban-done-btn");
		const el = projectPlay ?? checkbox ?? stepItem ?? play ?? done;
		if (!el) return;
		evt.stopPropagation();

		if (el === projectPlay) {
			const card = cardOf(el);
			if (card) this.timer?.start({ title: card.file.basename, projectFile: card.file });
		} else if (el === checkbox || el === stepItem) {
			const card = cardOf(el);
			const line = el.getAttribute("data-line");
			if (!card || !line) return;
			if (el === checkbox) void this.writes.toggleStep(card, +line);
			else this.openFileAtLine(card.file, +line);
		} else if (el === play) {
			const task = taskOf(el);
			if (task) this.timer?.start({ title: task.title, projectFile: task.projectFile });
		} else {
			const task = taskOf(el);
			if (task) void this.writes.taskTag(task, `#done ${localDay()}`);
		}
	}

	private openFileAtLine(file: TFile, line?: number) {
		const existingLeaf = this.app.workspace
			.getLeavesOfType("markdown")
			.find((leaf) => (leaf.view as MarkdownView).file?.path === file.path);
		const leaf = existingLeaf ?? this.app.workspace.getLeaf(false);
		if (!leaf) return;
		void this.app.workspace.revealLeaf(leaf);
		void leaf.openFile(file, line !== undefined ? { eState: { line } } : undefined);
	}

	async onClose() {
		this.timer?.stop();
		this.taskSub?.unsubscribe();
		this.taskSub = null;
		this.projectCardSub?.unsubscribe();
		this.projectCardSub = null;
		this.inboxUnsub?.();
		this.inboxUnsub = null;
		const rootEl = document.getElementById(this.rootId);
		if (rootEl && this.clickHandler) rootEl.removeEventListener("click", this.clickHandler, true);
		this.clickHandler = null;
		this.kanbanInstance = null;
	}
}
