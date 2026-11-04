import { Prec, type ChangeSpec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { indentEdits, type IndentEdit } from "./taskBodyIndent";

/**
 * Tab and Shift+Tab under a Tag task indent its body by two spaces
 * (`indentEdits`); anywhere else the editor's own Tab runs. Every selection
 * range must be under a Task, else nothing is taken over.
 */
export const taskBodyKeymap = Prec.highest(
	keymap.of([
		{ key: "Tab", run: (view) => indent(view, 1) },
		{ key: "Shift-Tab", run: (view) => indent(view, -1) },
	]),
);

function indent(view: EditorView, dir: 1 | -1): boolean {
	const { state } = view;
	const lines = state.doc.toString().split("\n");
	const all: IndentEdit[] = [];
	for (const range of state.selection.ranges) {
		const from = state.doc.lineAt(range.from).number - 1;
		// A selection ending at a line's start doesn't take that line.
		const endLine = state.doc.lineAt(range.to);
		const to = range.to > range.from && range.to === endLine.from ? endLine.number - 2 : endLine.number - 1;
		const edits = indentEdits(lines, from, Math.max(from, to), dir);
		if (!edits) return false;
		all.push(...edits);
	}
	const seen = new Set<number>();
	const specs: ChangeSpec[] = [];
	for (const e of all) {
		if (seen.has(e.line)) continue;
		seen.add(e.line);
		const start = state.doc.line(e.line + 1).from;
		specs.push({ from: start, to: start + e.remove, insert: e.insert });
	}
	const changes = state.changes(specs);
	// assoc 1: a cursor at the line's start moves past the indent typed there.
	view.dispatch({ changes, selection: state.selection.map(changes, 1), scrollIntoView: true, userEvent: dir === 1 ? "input.indent" : "delete.dedent" });
	return true;
}
