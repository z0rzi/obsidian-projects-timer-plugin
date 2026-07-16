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
import { ProjectCard, Task, TASKS_TYPES } from "../types";
import { Subscription } from "rxjs";
import { AddActivityModal } from "../ui/AddActivityModal";
import { setFrontmatterPriority, toggleCheckboxLine } from "../projectCards";

declare global {
	interface Window {
		jKanban: new (options: any) => any;
	}
}

export const TASKS_KANBAN_VIEW_TYPE = "tasks-kanban-view";

let idCounter = 0;

const PLAY_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const DONE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

function cardHtml(id: string, title: string, description: string): string {
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
		<span>${highlightedTitle}</span>
		<br>
		<small>${safeDescription}</small>
		<span class="kanban-card-actions">
			<span class="kanban-done-btn" data-task-id="${id}">${DONE_ICON}</span>
			<span class="kanban-play-btn" data-task-id="${id}">${PLAY_ICON}</span>
		</span>
		`;
}

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
				<div class="kanban-project-item${item.checked ? " is-checked" : ""}" data-project-id="${card.id}" data-line="${item.line}">
					<input type="checkbox" class="kanban-project-item-checkbox" data-project-id="${card.id}" data-line="${item.line}" ${item.checked ? "checked" : ""} />
					<span class="kanban-project-item-text">${safeText}</span>
				</div>
			`;
		})
		.join("");

	return `
		<span style="font-weight: bold;">${safeTitle}</span>
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

type BoardDef = { id: string; title: string; class: string; items: any[] };

export class TasksKanbanView extends ItemView {
	private kanbanInstance: any;
	private rootId: string;
	private clickHandler: ((evt: MouseEvent) => void) | null = null;
	private taskSub: Subscription | null = null;
	private projectCardSub: Subscription | null = null;
	private currentTasks: Map<string, Task> = new Map();
	private currentProjectCards: Map<string, ProjectCard> = new Map();
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

		this.taskSub = this.plugin.allTasks.subscribe((tasks) => {
			this.updateBoards(tasks);
		});
		this.projectCardSub = this.plugin.allProjectCards.subscribe(() => {
			this.updateBoards(this.plugin.allTasks.getValue());
		});
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
					`${task.id}:${task.priority}:${task.title}:${task.description}:${task.line}`,
			)
			.join("|");
		const cardPart = projectCards
			.map(
				(card) =>
					`${card.id}:${card.priority}:${card.items
						.map((item) => `${item.line}:${item.checked ? 1 : 0}:${item.text}`)
						.join(",")}`,
			)
			.join("|");
		return `${taskPart}##${cardPart}`;
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
		tasks.sort((a, b) => {
			const aType = typeOrder.indexOf(a.type);
			const bType = typeOrder.indexOf(b.type);
			if (aType === bType) return 0;
			return aType > bType ? 1 : -1;
		});

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

		// Applying card styles dynamically
		setTimeout(() => {
			let styleStr = "";

			for (const cardType of TASKS_TYPES) {
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
					.tasks-kanban-view-container .kanban-item[data-type="${cardType.tag}"] {
						position: relative;
						${props.join('\n')};
					}
					.tasks-kanban-view-container .kanban-item[data-type="${cardType.tag}"]::before {
						content: "${cardType.tag}";
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
					const cardId = eid.replace("project-", "");
					const card = this.currentProjectCards.get(cardId);
					if (!card) return;
					this.updateProjectPriority(card, newPriority);
					return;
				}

				const taskId = eid.replace("task-", "");
				const task = this.currentTasks.get(taskId);
				if (!task) return;

				let newTag = task.type ? `#${task.type}` : "#task";
				newTag += ` p${newPriority ?? 1}`;

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
				const strDate = new Date().toISOString().split("T")[0];
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
		try {
			const content = await this.app.vault.read(task.file);
			const lines = content.split("\n");
			const line = lines[task.line];
			if (!line) return;

			const newLine = `${newTag} ${task.title.trim()}`;
			if (line === newLine) return;

			lines[task.line] = newLine;
			await this.app.vault.modify(task.file, lines.join("\n"));
		} catch (e) {
			new Notice("Failed to update task tag");
		}
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
		try {
			const content = await this.app.vault.adapter.read(card.file.path);
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

	private startTimerForProjectCard(card: ProjectCard) {
		const pseudoTask: Task = {
			id: `project:${card.id}`,
			title: card.file.basename,
			description: "",
			file: card.file,
			projectFile: card.file,
			line: 0,
			priority: card.priority,
			// "project" is not yet part of the committed TaskTagLabel union
			// (TASKS_TYPES gains a "project" entry via a separate, still-uncommitted
			// change to src/types.ts). Cast to keep this a no-op once that lands.
			type: "project" as Task["type"],
		};
		this.startTimerForTask(pseudoTask);
	}

	private async updateProjectPriority(card: ProjectCard, newPriority: number) {
		try {
			const content = await this.app.vault.adapter.read(card.file.path);
			const newContent = setFrontmatterPriority(content, newPriority);
			if (newContent === content) return;

			await this.app.vault.modify(card.file, newContent);
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
		const rootEl = document.getElementById(this.rootId);
		if (rootEl && this.clickHandler) {
			rootEl.removeEventListener("click", this.clickHandler, true);
		}
		this.clickHandler = null;
		this.kanbanInstance = null;
	}
}
