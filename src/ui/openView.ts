import { Notice, type App, type WorkspaceLeaf } from "obsidian";

/**
 * Shows the view `type` in the right sidebar: its open leaf if there is one,
 * else a new one. Returns the leaf, or null (with a notice naming `label`).
 */
export async function openView(
	app: App,
	type: string,
	label: string,
	opts: { active: boolean },
): Promise<WorkspaceLeaf | null> {
	const existing = app.workspace.getLeavesOfType(type)[0];
	const leaf = existing ?? app.workspace.getRightLeaf(false);
	if (!leaf) {
		new Notice(`Unable to open the ${label}`);
		return null;
	}
	if (!existing) await leaf.setViewState({ type, active: opts.active });
	void app.workspace.revealLeaf(leaf);
	return leaf;
}
