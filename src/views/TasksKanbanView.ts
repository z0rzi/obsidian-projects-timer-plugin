import {
	ItemView,
	WorkspaceLeaf,
	Notice,
	setIcon,
	TFile,
	MarkdownView,
} from "obsidian";
import "jkanban";
import type ProjectsTimerPlugin from "../main";
import { ProjectCard, ProjectCardItem, Task, TaskStatus, TASKS_TYPES } from "../types";
import { Subscription } from "rxjs";
import { AddActivityModal } from "../ui/AddActivityModal";
import { rewriteStepToken, rewriteTaskTag, toggleCheckbox, WriteResult } from "../lineWriter";
import { localDay } from "../localDate";

declare global {
	interface Window {
		jKanban: new (options: any) => any;
	}
}

export const TASKS_KANBAN_VIEW_TYPE = "tasks-kanban-view";

let idCounter = 0;

const PLAY_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const DONE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

/** Dot on a card or step whose item has unread Client comments (Suivi Inbox). */
const UNREAD_DOT = '<span class="suivi-unread-dot" aria-label="Unread comments" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--color-accent);margin-right:4px;vertical-align:middle"></span>';

function cardHtml(id: string, title: string, description: string, unread = false): string {
	const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const safeDescription = description
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\n/g, "<br/>");

	const highlightedTitle = safeTitle.replace(
		/\[(.+?)\]/g,
		'<span style="color: var(--text-faint)">[<span style="color: var(--card-color);">$1</span>]</span>',
	);

	return `
		<span>${unread ? UNREAD_DOT : ""}${highlightedTitle}</span>
		<br>
		<small>${safeDescription}</small>
		<span class="kanban-card-actions">
			<span class="kanban-done-btn" data-task-id="${id}">${DONE_ICON}</span>
			<span class="kanban-play-btn" data-task-id="${id}">${PLAY_ICON}</span>
		</span>
		`;
}

function escapeHtml(text: string): string {
	return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stepItemHtml(card: ProjectCard, item: ProjectCardItem, extraClass = "", unread = new Set<string>()): string {
	const classes = ["kanban-project-item", item.checked ? "is-checked" : "", extraClass]
		.filter(Boolean)
		.join(" ");
	return `
		<div class="${classes}" data-project-id="${card.id}" data-line="${item.line}">
			<input type="checkbox" class="kanban-project-item-checkbox" data-project-id="${card.id}" data-line="${item.line}" ${item.checked ? "checked" : ""} />
			<span class="kanban-project-item-text">${item.blockId && unread.has(item.blockId) ? UNREAD_DOT : ""}${escapeHtml(item.text)}</span>
		</div>
	`;
}

/** Card of an Override: the step itself, with its Project's name. */
function overrideCardHtml(card: ProjectCard, item: ProjectCardItem, unread: Set<string>): string {
	return `
		${stepItemHtml(card, item, "", unread)}
		<small style="color: var(--text-faint)">${escapeHtml(card.file.basename)}</small>
		`;
}

/** `unread`: app ids with unread comments; `suiviId`: the Project's own. */
function projectCardHtml(card: ProjectCard, unread: Set<string>, suiviId?: string): string {
	const safeTitle = card.file.basename
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

	const itemsHtml = card.items
		.map((item) => stepItemHtml(card, item, item.override ? "is-override" : "", unread))
		.join("");

	return `
		<span style="font-weight: bold;">${suiviId && unread.has(suiviId) ? UNREAD_DOT : ""}${safeTitle}</span>
		${itemsHtml}
		<span class="kanban-card-actions">
			<span class="kanban-play-btn" data-project-id="${card.id}">${PLAY_ICON}</span>
		</span>
		`;
}

const REVIEW_BOARD_ID = "pr";

function priorityToBoardId(priority: number): string {
	if (priority === 0) return "doing";
	if (priority >= 5) return "p5";
	if (priority >= 4) return "p4";
	if (priority >= 3) return "p3";
	if (priority >= 2) return "p2";
	return "p1";
}

function statusBoardId(item: { priority: number; status: TaskStatus }): string {
	if (item.status === "review") return REVIEW_BOARD_ID;
	return priorityToBoardId(item.priority);
}

/** Status token written on the line when a card is dropped on a board. */
function boardIdToToken(boardId: string): string | null {
	if (boardId === REVIEW_BOARD_ID) return "pr";
	if (boardId === "doing") return "p0";
	return /^p[1-5]$/.test(boardId) ? boardId : null;
}

const PROJECT_CARD_STYLE = {
	label: "project",
	color: "#2677b8",
	css: "border: 3px solid var(--card-color);",
};

const OVERRIDE_CARD_STYLE = {
	label: "step",
	color: "#2677b8",
	css: "border-left: 4px solid var(--card-color);",
};

type StepRef = { card: ProjectCard; item: ProjectCardItem };

type BoardDef = { id: string; title: string; class: string; items: any[] };

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
	private footerEl: HTMLElement | null = null;
	timerState: {
		task: Task | null;
		startedAt: Date | null;
		stop: () => void;
	} | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ProjectsTimerPlugin,
	) {
		super(leaf);
		this.rootId = `kanban-root-${++idCounter}`;
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
		const container = this.containerEl.children[1];
		if (!container) return;
		container.empty();
		container.addClass("tasks-kanban-view-container");
		(container as HTMLElement).style.display = "flex";
		(container as HTMLElement).style.flexDirection = "column";

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
			const filteredTasks = allTasks.filter(
				(task) =>
					task.title.toLowerCase().includes(search) ||
					task.description.toLowerCase().includes(search),
			);
			this.updateBoards(filteredTasks);
		});

		const kanbanContainer = container.createDiv("kanban-container-wrapper");
		kanbanContainer.style.flexGrow = "1";
		kanbanContainer.style.width = "100%";
		kanbanContainer.style.overflowY = "auto";
		kanbanContainer.style.overflowX = "hidden";

		const kanbanRoot = kanbanContainer.createDiv();
		kanbanRoot.id = this.rootId;

		this.footerEl = container.createDiv("kanban-timer-footer");
		this.footerEl.style.flexGrow = "0";
		this.footerEl.style.width = "100%";

		// jKanban drops into boards, not onto cards: remember where the pointer was.
		this.registerDomEvent(document, "mousemove", (evt) => {
			this.lastPointer = { x: evt.clientX, y: evt.clientY };
		});

		this.taskSub = this.plugin.allTasks.subscribe((tasks) => {
			this.updateBoards(tasks);
		});
		this.projectCardSub = this.plugin.allProjectCards.subscribe(() => {
			this.updateBoards(this.plugin.allTasks.getValue());
		});
		this.inboxUnsub = this.plugin.inbox?.subscribe(() => this.updateBoards(this.plugin.allTasks.getValue())) ?? null;
	}

	private updateBoards(tasks: Task[]) {
		if (this.isRendering) {
			requestAnimationFrame(() => this.updateBoards(tasks));
			return;
		}

		const projectCards = this.plugin.allProjectCards.getValue();

		// Only re-render if the board content actually changed
		const snapshot = this.buildSnapshot(tasks, projectCards);
		if (snapshot === this.lastSnapshot) return;
		this.lastSnapshot = snapshot;

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

	private buildSnapshot(tasks: Task[], projectCards: ProjectCard[]): string {
		const taskPart = tasks
			.map(
				(task) =>
					`${task.id}:${task.priority}:${task.status}:${task.title}:${task.description}:${task.line}`,
			)
			.join("|");
		const cardPart = projectCards
			.map(
				(card) =>
					`${card.id}:${card.priority}:${[...card.items, ...card.overrides]
						.map(
							(item) =>
								`${item.line}:${item.checked ? 1 : 0}:${item.override?.status ?? ""}${item.override?.priority ?? ""}:${item.text}`,
						)
						.join(",")}`,
			)
			.join("|");
		return `${taskPart}##${cardPart}##${[...this.unread()].sort().join(",")}`;
	}

	/** App ids of items with unread Client comments. */
	private unread(): Set<string> {
		return this.plugin.inbox?.store.unreadComments() ?? new Set();
	}

	/** App id of the Project pushed from `path`. */
	private suiviIdOf(path: string): string | undefined {
		const pushed = this.plugin.data.sync.pushedProjects;
		return Object.keys(pushed).find((id) => pushed[id]!.path === path);
	}

	private renderBoards(tasks: Task[], projectCards: ProjectCard[]) {
		const rootEl = document.getElementById(this.rootId);
		if (!rootEl) return;

		this.isRendering = true;

		// Clean up previous state
		if (this.kanbanInstance) {
			this.kanbanInstance = null;
		}
		if (this.clickHandler) {
			rootEl.removeEventListener("click", this.clickHandler, true);
			this.clickHandler = null;
		}
		rootEl.innerHTML = "";

		const boards: BoardDef[] = [
			{
				id: REVIEW_BOARD_ID,
				title: "À valider",
				class: "kanban-board-review",
				items: [],
			},
			{
				id: "doing",
				title: "doing",
				class: "kanban-board-doing",
				items: [],
			},
			{
				id: "p1",
				title: "P1",
				class: "kanban-board-priority",
				items: [],
			},
			{
				id: "p2",
				title: "P2",
				class: "kanban-board-priority",
				items: [],
			},
			{
				id: "p3",
				title: "P3",
				class: "kanban-board-priority",
				items: [],
			},
			{
				id: "p4",
				title: "P4",
				class: "kanban-board-priority",
				items: [],
			},
			{
				id: "p5",
				title: "P5",
				class: "kanban-board-priority",
				items: [],
			},
		];

		const typeOrder = TASKS_TYPES.map((t) => t.tag);
		const unread = this.unread();
		tasks.sort((a, b) => {
			const aType = typeOrder.indexOf(a.type);
			const bType = typeOrder.indexOf(b.type);
			if (aType === bType) return 0;
			return aType > bType ? 1 : -1;
		});

		for (const task of tasks) {
			if (task.priority === -1) continue;
			const boardId = statusBoardId(task);

			const board = boards.find((b) => b.id === boardId);
			if (!board) continue;

			board.items.push({
				id: `task-${task.id}`,
				title: cardHtml(
					String(task.id),
					task.title,
					task.description.trim(),
					!!task.blockId && unread.has(task.blockId),
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
				title: projectCardHtml(card, unread, this.suiviIdOf(card.file.path)),
				type: "project",
			});
		}

		this.currentSteps.clear();
		for (const card of projectCards) {
			for (const item of card.overrides) {
				const board = boards.find((b) => b.id === statusBoardId(item.override!));
				if (!board) continue;
				const id = `step-${this.currentSteps.size}`;
				this.currentSteps.set(id, { card, item });
				board.items.push({
					id,
					title: overrideCardHtml(card, item, unread),
					type: OVERRIDE_CARD_STYLE.label,
				});
			}
		}

		// Applying card styles dynamically
		setTimeout(() => {
			let styleStr = "";

			const cardStyles = [
				...TASKS_TYPES.map((t) => ({ label: t.tag, color: t.color, css: t.css })),
				PROJECT_CARD_STYLE,
				OVERRIDE_CARD_STYLE,
			];
			for (const cardType of cardStyles) {
				const props = [] as string[];
				if (cardType.color) {
					props.push(`
						--card-color: ${cardType.color};
					`);
				}
				if (cardType.css) {
					props.push(cardType.css);
				}

				styleStr += `
					.tasks-kanban-view-container .kanban-item[data-type="${cardType.label}"] {
						position: relative;
						${props.join('\n')};
					}
					.tasks-kanban-view-container .kanban-item[data-type="${cardType.label}"]::before {
						content: "${cardType.label}";
						display: block;
						position: absolute;
						top: 0;
						right: 0;
						font-style: italic;
						font-size: 0.8em;
						color: white;
						opacity: 0.2;
						padding: 5px;
					}
				`;
			}

			styleStr += `
				.tasks-kanban-view-container .kanban-project-item {
					display: flex;
					align-items: center;
					gap: 6px;
					font-size: 0.85em;
					cursor: pointer;
				}
				.tasks-kanban-view-container .kanban-project-item-checkbox {
					cursor: pointer;
					margin: 0;
					flex-shrink: 0;
				}
				.tasks-kanban-view-container .kanban-project-item.is-override {
					opacity: 0.45;
				}
				.tasks-kanban-view-container .kanban-project-item.is-checked .kanban-project-item-text {
					text-decoration: line-through;
					color: var(--text-faint);
				}
			`;
			styleStr += "";

			const root = document.getElementById(this.rootId);
			const style = root?.createEl("style");
			style?.setText(styleStr);
		}, 10);

		this.kanbanInstance = new window.jKanban({
			element: `#${this.rootId}`,
			gutter: "10px",
			widthBoard: "260px",
			responsivePercentage: false,
			dragItems: true,
			dragBoards: false,
			boards: boards.map((b) => ({
				id: b.id,
				title: b.title,
				class: b.class,
				item: b.items,
			})),
			click: (el: HTMLElement) => {
				const eid = el.getAttribute("data-eid");
				if (!eid) return;

				const step = this.currentSteps.get(eid);
				if (step) {
					this.openFileAtLine(step.card.file, step.item.line);
					return;
				}

				if (eid.startsWith("project-")) {
					const id = eid.replace("project-", "");
					const card = this.currentProjectCards.get(id);
					if (!card) return;
					this.openFileAtLine(card.file);
					return;
				}

				const id = eid.replace("task-", "");
				const task = this.currentTasks.get(id);
				if (!task) return;
				this.openFileAtLine(task.file, task.line);
			},
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

				const step = this.currentSteps.get(eid);
				if (step) {
					const backOnProject = this.isDroppedOnProjectCard(el, step.card);
					const token = backOnProject ? null : boardIdToToken(targetBoardId);
					if (!backOnProject && !token) return;
					await this.updateStepToken(step, token);
					return;
				}

				const token = boardIdToToken(targetBoardId);
				if (!token) return;

				if (eid.startsWith("project-")) {
					const cardId = eid.replace("project-", "");
					const card = this.currentProjectCards.get(cardId);
					if (!card) return;
					if (token === "pr") {
						// Projects have no À valider status: put the card back.
						this.lastSnapshot = null;
						this.updateBoards(this.plugin.allTasks.getValue());
						return;
					}
					this.updateProjectPriority(card, +token.slice(1));
					return;
				}

				const taskId = eid.replace("task-", "");
				const task = this.currentTasks.get(taskId);
				if (!task) return;

				const newTag = `${task.type ? `#${task.type}` : "#task"} ${token}`;
				this.updateTaskTag(task, newTag);
			},
		});

		this.clickHandler = (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;

			const projectPlayBtn = target.closest(
				"span.kanban-play-btn[data-project-id]",
			) as HTMLElement | null;
			if (projectPlayBtn) {
				evt.stopPropagation();
				const cardId = projectPlayBtn.getAttribute("data-project-id");
				if (cardId) {
					const card = this.currentProjectCards.get(cardId);
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
					const card = this.currentProjectCards.get(cardId);
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
					const card = this.currentProjectCards.get(cardId);
					if (card) this.openFileAtLine(card.file, +line);
				}
				return;
			}

			const playBtn = target.closest(
				".kanban-play-btn",
			) as HTMLElement | null;
			if (playBtn) {
				evt.stopPropagation();
				const taskId = playBtn.getAttribute("data-task-id");
				if (taskId) {
					const task = this.currentTasks.get(taskId);
					if (task) this.startTimerForTask(task);
				}
				return;
			}

			const doneBtn = target.closest(
				".kanban-done-btn",
			) as HTMLElement | null;
			if (doneBtn) {
				evt.stopPropagation();
				const rawId = doneBtn.getAttribute("data-task-id");
				if (!rawId) return;
				const task = this.currentTasks.get(rawId);
				if (!task) return;
				const strDate = localDay();
				this.updateTaskTag(task, "#done " + strDate);
			}
		};
		rootEl.addEventListener("click", this.clickHandler, true);

		// Allow next update after a tick
		requestAnimationFrame(() => {
			this.isRendering = false;
		});
	}

	private async updateTaskTag(task: Task, newTag: string) {
		await this.writeLine(task.file, "Failed to update task tag", (content) =>
			rewriteTaskTag(content, task, newTag),
		);
	}

	/** Rewrites one line located by identity; refuses with a notice if it can't be found safely. */
	private async writeLine(
		file: TFile,
		failMessage: string,
		rewrite: (content: string) => WriteResult,
	): Promise<boolean> {
		let refused: WriteResult | null = null;
		let changed = false;
		try {
			await this.app.vault.process(file, (content) => {
				const result = rewrite(content);
				if (!result.ok) {
					refused = result;
					return content;
				}
				changed = result.content !== content;
				return result.content;
			});
		} catch (e) {
			new Notice(failMessage);
			return false;
		}
		if (refused) {
			new Notice(
				`Not updated: the line in ${file.basename} changed since the kanban loaded. Reload and try again.`,
			);
		}
		return changed;
	}

	/** Pointer over the Project card, or the drop landed right next to it. */
	private isDroppedOnProjectCard(el: HTMLElement, card: ProjectCard): boolean {
		const isProjectCard = (node: Element | null) =>
			node?.getAttribute("data-eid") === `project-${card.id}`;
		if (isProjectCard(el.previousElementSibling) || isProjectCard(el.nextElementSibling)) {
			return true;
		}
		if (!this.lastPointer) return false;
		return document
			.elementsFromPoint(this.lastPointer.x, this.lastPointer.y)
			.some((node) => !node.closest(".gu-mirror") && isProjectCard(node.closest(".kanban-item")));
	}

	private async updateStepToken(step: StepRef, token: string | null) {
		const written = await this.writeLine(step.card.file, "Failed to update project step", (content) =>
			rewriteStepToken(content, step.item, token),
		);
		if (written) return;
		// Nothing written: jKanban already moved the card in the DOM, put it back.
		this.lastSnapshot = null;
		this.updateBoards(this.plugin.allTasks.getValue());
	}

	private openFileAtLine(file: TFile, line?: number) {
		const existingLeaf = this.app.workspace
			.getLeavesOfType("markdown")
			.find(
				(leaf) => (leaf.view as MarkdownView).file?.path === file.path,
			);
		const leaf = existingLeaf ?? this.app.workspace.getLeaf(false);
		if (!leaf) return;
		this.app.workspace.revealLeaf(leaf);
		leaf.openFile(file, line !== undefined ? { eState: { line } } : undefined);
	}

	private async updateProjectCheckbox(card: ProjectCard, line: number) {
		const item = [...card.items, ...card.overrides].find((i) => i.line === line);
		if (!item) return;
		await this.writeLine(card.file, "Failed to update task checkbox", (content) =>
			toggleCheckbox(content, item),
		);
	}

	private startTimerForProjectCard(card: ProjectCard) {
		const pseudoTask: Task = {
			id: `project:${card.id}`,
			title: card.file.basename,
			description: "",
			file: card.file,
			projectFile: card.file,
			line: 0,
			raw: "",
			priority: card.priority,
			status: "priority",
			type: "task",
		};
		this.startTimerForTask(pseudoTask);
	}

	private async updateProjectPriority(card: ProjectCard, newPriority: number) {
		try {
			await this.app.fileManager.processFrontMatter(card.file, (fm: Record<string, unknown>) => {
				fm.priority = newPriority;
			});
		} catch (e) {
			new Notice("Failed to update project priority");
		}
	}

	startTimerForTask(task: Task): void {
		console.log("🐻", task);
		if (this.timerState?.stop) this.timerState.stop();
		this.timerState = {
			task,
			startedAt: new Date(),
			stop: () => {},
		};

		const playButtons =
			this.containerEl.querySelectorAll(".kanban-play-btn");
		playButtons.forEach((btn: HTMLElement) => (btn.style.display = "none"));

		this.renderTimer();
	}

	renderTimer(): void {
		if (!this.footerEl) return;
		this.footerEl.empty();

		if (!this.timerState || !this.timerState.task) {
			this.timerState = null;
			return;
		}

		const timerEl = this.footerEl.createDiv("kanban-timer-bar");
		timerEl.style.display = "flex";
		timerEl.style.alignItems = "center";
		timerEl.style.gap = "8px";
		timerEl.style.padding = "12px";
		timerEl.style.paddingBottom = "0px";
		timerEl.style.width = "100%";
		timerEl.style.boxSizing = "border-box";
		timerEl.style.borderTop = "1px solid var(--background-modifier-border)";

		const titleEl = timerEl.createSpan();
		titleEl.textContent = this.timerState.task.title;
		titleEl.style.flex = "1";
		titleEl.style.overflow = "hidden";
		titleEl.style.textOverflow = "ellipsis";
		titleEl.style.whiteSpace = "nowrap";

		const minusBtn = timerEl.createSpan("kanban-timer-btn");
		setIcon(minusBtn, "minus");
		minusBtn.style.cursor = "pointer";
		minusBtn.addEventListener("click", () => {
			if (this.timerState?.startedAt) {
				let newStart = new Date(
					this.timerState.startedAt.getTime() + 10 * 60 * 1000,
				);
				if (newStart > new Date()) newStart = new Date();
				this.timerState.startedAt = newStart;
				updateTimer();
			}
		});

		const timerTimeEl = timerEl.createSpan("kanban-timer-time");
		timerTimeEl.style.fontVariantNumeric = "tabular-nums";
		timerTimeEl.style.minWidth = "60px";
		timerTimeEl.style.textAlign = "center";
		timerTimeEl.style.color = "var(--text-faint)";

		const updateTimer = () => {
			if (!this.timerState?.startedAt) return;
			const elapsed = Date.now() - this.timerState.startedAt.getTime();
			const totalSeconds = Math.max(0, Math.floor(elapsed / 1000));
			const hours = Math.floor(totalSeconds / 3600);
			const minutes = Math.floor((totalSeconds % 3600) / 60);
			const seconds = totalSeconds % 60;
			const pad = (n: number) => String(n).padStart(2, "0");
			timerTimeEl.innerHTML = `${hours > 0 ? pad(hours) + ":" : ""}${pad(minutes)}:${pad(seconds)}`;
		};
		updateTimer();
		const iid = window.setInterval(updateTimer, 1000);

		const plusBtn = timerEl.createSpan("kanban-timer-btn");
		setIcon(plusBtn, "plus");
		plusBtn.style.cursor = "pointer";
		plusBtn.addEventListener("click", () => {
			if (this.timerState?.startedAt) {
				this.timerState.startedAt = new Date(
					this.timerState.startedAt.getTime() - 10 * 60 * 1000,
				);
			}
			updateTimer();
		});

		const pauseBtn = timerEl.createSpan("kanban-timer-btn");
		setIcon(pauseBtn, "pause");
		pauseBtn.style.cursor = "pointer";
		pauseBtn.style.color = "#f56565";
		pauseBtn.style.backgroundColor = "#f5656522";
		pauseBtn.style.padding = "5px";
		pauseBtn.style.paddingBottom = "1px";
		pauseBtn.style.borderRadius = "50%";
		pauseBtn.addEventListener("click", () => {
			if (!this.timerState?.startedAt || !this.timerState.task) return;

			const elapsedMs = Date.now() - this.timerState.startedAt.getTime();
			const elapsedMins = Math.max(1, Math.round(elapsedMs / 60000));
			const task = this.timerState.task;

			if (this.timerState.stop) this.timerState.stop();

			if (elapsedMins < 10) {
				new Notice("Time too short to record");
				return;
			}

			const roundedMins = Math.round(elapsedMins / 10) * 10;

			new AddActivityModal(
				this.app,
				(duration, description, projectFile) => {
					this.plugin.addActivityToFile(
						projectFile,
						duration,
						description,
					);
				},
				(raw) => this.plugin.parseTime(raw),
				roundedMins,
				task.projectFile,
			).open();
		});

		this.timerState.stop = () => {
			clearInterval(iid);
			const state = this.timerState;
			if (state) {
				state.startedAt = null;
				state.task = null;
			}
			const playButtons =
				this.containerEl.querySelectorAll(".kanban-play-btn");
			playButtons.forEach(
				(btn: HTMLElement) => (btn.style.display = "flex"),
			);
			this.renderTimer();
		};
	}

	async onClose() {
		if (this.timerState?.stop) this.timerState.stop();
		if (this.taskSub) {
			this.taskSub.unsubscribe();
			this.taskSub = null;
		}
		if (this.projectCardSub) {
			this.projectCardSub.unsubscribe();
			this.projectCardSub = null;
		}
		this.inboxUnsub?.();
		this.inboxUnsub = null;
		const rootEl = document.getElementById(this.rootId);
		if (rootEl && this.clickHandler) {
			rootEl.removeEventListener("click", this.clickHandler, true);
		}
		this.clickHandler = null;
		this.kanbanInstance = null;
	}
}
