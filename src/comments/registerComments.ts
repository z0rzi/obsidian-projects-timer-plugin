import { MarkdownView, type Plugin, type WorkspaceLeaf } from "obsidian";
import { listeners, settingsRemote } from "../remote/settingsRemote";
import { openView } from "../ui/openView";
import type { ProjectsTimerSettings } from "../settings";
import type { PluginData } from "../sync/pluginData";
import { COMMENT_PANEL_VIEW_TYPE, CommentPanelView } from "../views/CommentPanelView";
import { commentTargetAt, type CommentTarget } from "./commentTarget";
import { ThreadSession, type ThreadState } from "./threadSession";

/** How often the open panel checks what is under the cursor. */
const CURSOR_POLL_MS = 500;

/**
 * Comment side panel: follows the cursor in the active note and shows the
 * Client app thread of the Task or Project there. Network calls only while
 * the panel is open.
 */
export function registerComments(plugin: Plugin, data: PluginData<ProjectsTimerSettings>) {
	const { app } = plugin;
	const remote = settingsRemote(data.settings);
	const { emit, subscribe } = listeners<ThreadState>();
	const session = new ThreadSession(remote, emit);

	plugin.registerView(
		COMMENT_PANEL_VIEW_TYPE,
		(leaf: WorkspaceLeaf) => new CommentPanelView(leaf, session, subscribe, () => data.settings.suiviUrl, (path) => remote.image(path)),
	);

	/** Last cursor position looked at, to skip re-reading an unchanged note. */
	let last = "";
	async function followCursor() {
		if (app.workspace.getLeavesOfType(COMMENT_PANEL_VIEW_TYPE).length === 0) return;
		// While typing in the panel the note isn't active: keep the thread shown.
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) return;
		const line = view.editor.getCursor().line;
		const content = view.editor.getValue();
		const key = `${view.file.path}\n${line}\n${content.length}`;
		if (key === last) return;
		last = key;
		await session.show(commentTargetAt(view.file.path, content, line));
	}
	plugin.registerInterval(window.setInterval(() => void followCursor(), CURSOR_POLL_MS));
	plugin.registerEvent(app.workspace.on("active-leaf-change", () => void followCursor()));

	async function openPanel() {
		const leaf = await openView(app, COMMENT_PANEL_VIEW_TYPE, "Suivi comments panel", { active: false }, CommentPanelView);
		if (!leaf) return;
		last = "";
		void followCursor();
	}

	plugin.addCommand({ id: "open-suivi-comments", name: "Open Suivi comments", callback: () => void openPanel() });
	plugin.addRibbonIcon("messages-square", "Open Suivi comments", () => void openPanel());

	return {
		/** Opens the panel on `target`'s thread (put the cursor on its line first so the panel keeps it). */
		async openThread(target: CommentTarget) {
			await openPanel();
			await session.show(target);
		},
	};
}
