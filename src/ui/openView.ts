import { Notice, type App, type View, type WorkspaceLeaf } from "obsidian";

/** The class registered for the view type, to tell a live view from a placeholder. */
type ViewClass = abstract new (...args: never[]) => View;

/**
 * Shows the view `type` in the right sidebar: its open leaf if there is one,
 * else a new one. Returns the leaf, or null (with a notice naming `label`).
 * An existing leaf is only revealed when its view is a live `view` instance:
 * a deferred leaf (restored from workspace.json) is loaded first, and a leaf
 * holding any other view (placeholder from before the plugin loaded, or from
 * a previous plugin instance) is rebuilt.
 */
export async function openView(
	app: App,
	type: string,
	label: string,
	opts: { active: boolean },
	view: ViewClass,
): Promise<WorkspaceLeaf | null> {
	const existing = app.workspace.getLeavesOfType(type)[0];
	const leaf = existing ?? app.workspace.getRightLeaf(false);
	if (!leaf) {
		new Notice(`Unable to open the ${label}`);
		return null;
	}
	if (leaf.isDeferred) await leaf.loadIfDeferred();
	if (!(leaf.view instanceof view)) {
		// Obsidian keeps a view whose type already matches: reset the leaf first, as its own rebuild does.
		if (existing) await leaf.setViewState({ type: "empty" });
		await leaf.setViewState({ type, active: opts.active });
	}
	void app.workspace.revealLeaf(leaf);
	return leaf;
}
