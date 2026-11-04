import { TASKS_TYPES } from "../types";

/**
 * Indent of a Task body line typed with Tab: two spaces, as the triage writes
 * it. After a blank line, a tab (or 4 spaces) would make Markdown render the
 * body as an indented code block, links and embeds shown raw.
 */
export const BODY_INDENT = "  ";

const TASK_LINE = new RegExp(`^#(?:${[...TASKS_TYPES.map((t) => t.tag), "done"].join("|")})(?=\\s|$)`);

/**
 * Whether line `at` is under a Tag task, where its body goes: walking up from
 * it (itself included) past blank and indented lines, the first line at indent
 * zero is a Task line (`#task`, `#bug`, …, `#done`). The Task line itself is
 * not under it.
 */
export function isUnderTask(lines: string[], at: number): boolean {
	for (let i = at; i >= 0; i--) {
		const line = lines[i] ?? "";
		if (!line.trim() || /^\s/.test(line)) continue;
		return i !== at && TASK_LINE.test(line);
	}
	return false;
}

/** One change to a line's start: `remove` characters deleted, then `insert` written. */
export type IndentEdit = { line: number; remove: number; insert: string };

/**
 * Tab (`dir` 1) or Shift+Tab (`dir` -1) over lines `from`..`to`: `BODY_INDENT`
 * added at the start of each non-blank line (of the cursor's line even blank),
 * or a leading tab or up to two spaces taken off. `null` when a line isn't
 * under a Task, so the editor does what it always does.
 */
export function indentEdits(lines: string[], from: number, to: number, dir: 1 | -1): IndentEdit[] | null {
	for (let i = from; i <= to; i++) if (!isUnderTask(lines, i)) return null;
	const edits: IndentEdit[] = [];
	for (let i = from; i <= to; i++) {
		const line = lines[i] ?? "";
		if (dir === 1) {
			if (line.trim() || from === to) edits.push({ line: i, remove: 0, insert: BODY_INDENT });
		} else {
			const remove = line.startsWith("\t") ? 1 : (/^ {1,2}/.exec(line)?.[0].length ?? 0);
			if (remove) edits.push({ line: i, remove, insert: "" });
		}
	}
	return edits;
}
