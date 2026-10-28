import type { PriorityToken } from "../../lineWriter";
import type { Priority } from "../../remote/api";
import { TASKS_TYPES } from "../../types";

export const A_VALIDER_BOARD_ID = "pr";
/** The Rapides' column: not a drop target, its cards not draggable. */
export const RAPIDES_BOARD_ID = "rapides";

/** `dragTo`: the boards its cards may be dropped on (jKanban); absent = any. */
export type BoardDef = { id: string; title: string; class: string; items: unknown[]; dragTo?: string[] };

/** The columns, left to right: to validate (À valider), doing (P0), rapides (Rapide), P1 to P5. */
export function emptyBoards(): BoardDef[] {
	const boards: BoardDef[] = [
		{ id: A_VALIDER_BOARD_ID, title: "to validate", class: "kanban-board-a-valider", items: [] },
		{ id: "doing", title: "doing", class: "kanban-board-doing", items: [] },
		{ id: RAPIDES_BOARD_ID, title: "rapides", class: "kanban-board-rapides", items: [] },
		...[1, 2, 3, 4, 5].map((p) => ({ id: `p${p}`, title: `P${p}`, class: "kanban-board-priority", items: [] })),
	];
	const targets = boards.map((b) => b.id).filter((id) => id !== RAPIDES_BOARD_ID);
	return boards.map((b) => (b.id === RAPIDES_BOARD_ID ? b : { ...b, dragTo: targets }));
}

/**
 * The column of a Priority: to validate for PR, doing for P0, rapides for
 * Rapide, P5 for anything above 5; null for PZ (in the app's Frigo, not on
 * the board) and for a value the plugin does not know.
 */
export function priorityBoardId(priority: Priority): string | null {
	if (priority === "pr") return A_VALIDER_BOARD_ID;
	if (priority === "pq") return RAPIDES_BOARD_ID;
	if (typeof priority !== "number") return null;
	if (priority === 0) return "doing";
	if (priority >= 5) return "p5";
	if (priority >= 4) return "p4";
	if (priority >= 3) return "p3";
	if (priority >= 2) return "p2";
	return "p1";
}

/**
 * Priority token written on the line when a card is dropped on a board;
 * "refused" on the Rapides' column (Rapide is the type's own rank, not one a
 * drop gives) and on a board the plugin does not know.
 */
export function boardDrop(boardId: string): PriorityToken | "refused" {
	if (boardId === RAPIDES_BOARD_ID) return "refused";
	if (boardId === A_VALIDER_BOARD_ID) return "pr";
	if (boardId === "doing") return "p0";
	return /^p[1-5]$/.test(boardId) ? (boardId as PriorityToken) : "refused";
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
	const markersCss = typeColorsCss([".tasks-kanban-view-container .kanban-type-label", ".tasks-kanban-view-container .kanban-step-dot"]);
	return [...cardsCss, markersCss].join("");
}

/**
 * The `--type-color` of each type with a colour in TASKS_TYPES, on the
 * elements `selectors` match carrying its `data-type`: the kanban's markers,
 * the Deck's (`.suivi-deck [data-type]`). A `#task` has none.
 */
export function typeColorsCss(selectors: string[]): string {
	return TASKS_TYPES.filter((t) => t.color)
		.map((t) => `${selectors.map((s) => `${s}[data-type="${t.tag}"]`).join(",\n")} {\n\t--type-color: ${t.color};\n}\n`)
		.join("");
}
