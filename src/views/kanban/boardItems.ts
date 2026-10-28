import { noteDate } from "../../noteDate";
import { TASKS_TYPES, type ProjectCard, type ProjectCardItem, type Task } from "../../types";
import { emptyBoards, OVERRIDE_CARD_STYLE, priorityBoardId, RAPIDES_BOARD_ID, type BoardDef } from "./boards";
import { badgeOf, cardHtml, overrideCardHtml, projectCardHtml } from "./cardHtml";

export type StepRef = { card: ProjectCard; item: ProjectCardItem };

/** What the board shows, as one string: the kanban redraws only when it changes. */
export function boardSnapshot(tasks: Task[], projectCards: ProjectCard[], badges: Map<string, string>): string {
	const taskPart = tasks
		.map((task) => `${task.id}:${task.priority}:${task.type}:${task.title}:${task.description}:${task.line}`)
		.join("|");
	const cardPart = projectCards
		.map(
			(card) =>
				`${card.id}:${card.priority}:${[...card.items, ...card.overrides]
					.map(
						(item) =>
							`${item.line}:${item.checked ? 1 : 0}:${item.type}:${item.override ?? ""}:${item.text}:${item.body}`,
					)
					.join(",")}`,
		)
		.join("|");
	const badgePart = [...badges].map(([id, text]) => `${id}=${text}`).sort();
	return `${taskPart}##${cardPart}##${badgePart.join(",")}`;
}

/**
 * The boards with their jKanban items: Tag tasks (`task-<id>`, by type
 * order; the Rapides oldest note first, not draggable), Project cards
 * (`project-<id>`) and Overrides (`step-<n>`, returned in `steps`). Work at
 * PZ is not shown: Tag tasks and Overrides at PZ, Projects at PZ with their
 * inheriting steps and their Rapides; an Override at a rank of its own stays.
 * `badges`: badge text by app id of the items with unread entries;
 * `suiviIdOf` gives a Project note's app id for its badge.
 */
export function fillBoards(
	tasks: Task[],
	projectCards: ProjectCard[],
	badges: Map<string, string>,
	suiviIdOf: (path: string) => string | undefined,
): { boards: BoardDef[]; steps: Map<string, StepRef> } {
	const boards = emptyBoards();
	const boardOf = (id: string | null) => (id === null ? undefined : boards.find((b) => b.id === id));
	const typeOrder = TASKS_TYPES.map((t) => t.tag);
	const frozen = new Set(projectCards.filter((c) => c.priority === "pz").map((c) => c.file.path));
	const shown = tasks.filter((t) => !(t.priority === "pq" && t.projectFile && frozen.has(t.projectFile.path)));
	const sorted = [...shown].sort((a, b) =>
		a.priority === "pq" && b.priority === "pq" ? byNoteDate(a, b) : typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type),
	);

	for (const task of sorted) {
		const boardId = priorityBoardId(task.priority);
		boardOf(boardId)?.items.push({
			id: `task-${task.id}`,
			title: cardHtml(String(task.id), task.title, task.description.trim(), task.type, badgeOf(badges, task.blockId)),
			type: task.type,
			...(boardId === RAPIDES_BOARD_ID ? { class: ["not-draggable"] } : {}),
		});
	}

	for (const card of projectCards) {
		boardOf(priorityBoardId(card.priority))?.items.push({
			id: `project-${card.id}`,
			title: projectCardHtml(card, badges, suiviIdOf(card.file.path)),
			type: "project",
		});
	}

	const steps = new Map<string, StepRef>();
	for (const card of projectCards) {
		for (const item of card.overrides) {
			const board = boardOf(priorityBoardId(item.override!));
			if (!board) continue;
			const id = `step-${steps.size}`;
			steps.set(id, { card, item });
			board.items.push({ id, title: overrideCardHtml(card, item, badges), type: OVERRIDE_CARD_STYLE.label });
		}
	}
	return { boards, steps };
}

/** Oldest note first (`noteDate`), then by creation time, then by line. */
function byNoteDate(a: Task, b: Task): number {
	return (
		noteDate(a.file).localeCompare(noteDate(b.file)) ||
		(a.file.stat?.ctime ?? 0) - (b.file.stat?.ctime ?? 0) ||
		a.file.path.localeCompare(b.file.path) ||
		a.line - b.line
	);
}
