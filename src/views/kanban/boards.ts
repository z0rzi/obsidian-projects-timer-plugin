import type { StatusToken } from "../../lineWriter";
import { TASKS_TYPES, type TaskStatus } from "../../types";

export const REVIEW_BOARD_ID = "pr";

export type BoardDef = { id: string; title: string; class: string; items: unknown[] };

/** The columns, left to right: À valider, doing (P0), P1 to P5. */
export function emptyBoards(): BoardDef[] {
	return [
		{ id: REVIEW_BOARD_ID, title: "À valider", class: "kanban-board-review", items: [] },
		{ id: "doing", title: "doing", class: "kanban-board-doing", items: [] },
		...[1, 2, 3, 4, 5].map((p) => ({ id: `p${p}`, title: `P${p}`, class: "kanban-board-priority", items: [] })),
	];
}

export function priorityToBoardId(priority: number): string {
	if (priority === 0) return "doing";
	if (priority >= 5) return "p5";
	if (priority >= 4) return "p4";
	if (priority >= 3) return "p3";
	if (priority >= 2) return "p2";
	return "p1";
}

export function statusBoardId(item: { priority: number; status: TaskStatus }): string {
	if (item.status === "review") return REVIEW_BOARD_ID;
	return priorityToBoardId(item.priority);
}

/** Status token written on the line when a card is dropped on a board. */
export function boardIdToToken(boardId: string): StatusToken | null {
	if (boardId === REVIEW_BOARD_ID) return "pr";
	if (boardId === "doing") return "p0";
	return /^p[1-5]$/.test(boardId) ? (boardId as StatusToken) : null;
}

export const PROJECT_CARD_STYLE = { label: "project", color: "#2677b8", css: "border: 3px solid var(--card-color);" };
export const OVERRIDE_CARD_STYLE = { label: "step", color: "#2677b8", css: "border-left: 4px solid var(--card-color);" };

/**
 * Per card type CSS (colour, border), from TASKS_TYPES plus Project and
 * Override cards, and the `--type-color` of the type labels and step dots
 * (laid out in styles.css).
 */
export function cardTypesCss(): string {
	const styles = [
		...TASKS_TYPES.map((t) => ({ label: t.tag, color: t.color, css: t.css })),
		PROJECT_CARD_STYLE,
		OVERRIDE_CARD_STYLE,
	];
	const cardsCss = styles.map((type) => {
		const props = [type.color ? `--card-color: ${type.color};` : "", type.css].filter(Boolean);
		return `
			.tasks-kanban-view-container .kanban-item[data-type="${type.label}"] {
				position: relative;
				${props.join("\n")};
			}
		`;
	});
	const markersCss = TASKS_TYPES.filter((t) => t.color).map(
		(t) => `
			.tasks-kanban-view-container .kanban-type-label[data-type="${t.tag}"],
			.tasks-kanban-view-container .kanban-step-dot[data-type="${t.tag}"] {
				--type-color: ${t.color};
			}
		`,
	);
	return [...cardsCss, ...markersCss].join("");
}
