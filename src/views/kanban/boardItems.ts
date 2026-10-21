import { TASKS_TYPES, type ProjectCard, type ProjectCardItem, type Task } from "../../types";
import { emptyBoards, OVERRIDE_CARD_STYLE, priorityToBoardId, statusBoardId, type BoardDef } from "./boards";
import { cardHtml, overrideCardHtml, projectCardHtml } from "./cardHtml";

export type StepRef = { card: ProjectCard; item: ProjectCardItem };

/** What the board shows, as one string: the kanban redraws only when it changes. */
export function boardSnapshot(tasks: Task[], projectCards: ProjectCard[], unread: Set<string>): string {
	const taskPart = tasks
		.map((task) => `${task.id}:${task.priority}:${task.status}:${task.title}:${task.description}:${task.line}`)
		.join("|");
	const cardPart = projectCards
		.map(
			(card) =>
				`${card.id}:${card.priority}:${[...card.items, ...card.overrides]
					.map(
						(item) =>
							`${item.line}:${item.checked ? 1 : 0}:${item.type}:${item.override?.status ?? ""}${item.override?.priority ?? ""}:${item.text}:${item.body}`,
					)
					.join(",")}`,
		)
		.join("|");
	return `${taskPart}##${cardPart}##${[...unread].sort().join(",")}`;
}

/**
 * The boards with their jKanban items: Tag tasks (`task-<id>`, by type
 * order), Project cards (`project-<id>`) and Overrides (`step-<n>`, returned
 * in `steps`). `suiviIdOf` gives a Project note's app id for its unread dot.
 */
export function fillBoards(
	tasks: Task[],
	projectCards: ProjectCard[],
	unread: Set<string>,
	suiviIdOf: (path: string) => string | undefined,
): { boards: BoardDef[]; steps: Map<string, StepRef> } {
	const boards = emptyBoards();
	const boardOf = (id: string) => boards.find((b) => b.id === id);
	const typeOrder = TASKS_TYPES.map((t) => t.tag);
	const sorted = [...tasks].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));

	for (const task of sorted) {
		if (task.priority === -1) continue;
		boardOf(statusBoardId(task))?.items.push({
			id: `task-${task.id}`,
			title: cardHtml(String(task.id), task.title, task.description.trim(), task.type, !!task.blockId && unread.has(task.blockId)),
			type: task.type,
		});
	}

	for (const card of projectCards) {
		boardOf(priorityToBoardId(card.priority))?.items.push({
			id: `project-${card.id}`,
			title: projectCardHtml(card, unread, suiviIdOf(card.file.path)),
			type: "project",
		});
	}

	const steps = new Map<string, StepRef>();
	for (const card of projectCards) {
		for (const item of card.overrides) {
			const board = boardOf(statusBoardId(item.override!));
			if (!board) continue;
			const id = `step-${steps.size}`;
			steps.set(id, { card, item });
			board.items.push({ id, title: overrideCardHtml(card, item, unread), type: OVERRIDE_CARD_STYLE.label });
		}
	}
	return { boards, steps };
}
