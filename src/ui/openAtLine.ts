import { MarkdownView, type TFile, type WorkspaceLeaf } from "obsidian";

/**
 * Opens `file` in `leaf`, active, scrolled to `line` (0-based) with the cursor on it. The cursor matters: the
 * comments panel follows it, and `eState.line` alone only scrolls, leaving the cursor where it was in a note
 * already open.
 */
export async function openAtLine(leaf: WorkspaceLeaf, file: TFile, line?: number): Promise<void> {
	await leaf.openFile(file, { active: true, ...(line !== undefined ? { eState: { line } } : {}) });
	if (line === undefined || !(leaf.view instanceof MarkdownView)) return;
	leaf.view.editor.setCursor({ line, ch: 0 });
}
