import { MarkdownView, Notice, type Plugin, type WorkspaceLeaf } from "obsidian";
import { obsidianTransport } from "../remote/obsidianTransport";
import { createHttpRemote } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import type { PluginData } from "../sync/pluginData";
import { COMMENT_PANEL_VIEW_TYPE, CommentPanelView } from "../views/CommentPanelView";
import { commentTargetAt, type CommentTarget } from "./commentTarget";
import { reviewsFolder } from "../sync/sharedReview";
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
	const remote = createHttpRemote(
		{
			get url() {
				return data.settings.suiviUrl;
			},
			get token() {
				return data.settings.suiviToken;
			},
		},
		obsidianTransport,
	);
	const listeners = new Set<(state: ThreadState) => void>();
	const session = new ThreadSession(remote, (state) => listeners.forEach((l) => l(state)));
	const subscribe = (listener: (state: ThreadState) => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};

	plugin.registerView(
		COMMENT_PANEL_VIEW_TYPE,
		(leaf: WorkspaceLeaf) => new CommentPanelView(leaf, session, subscribe, () => data.settings.suiviUrl),
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
		await session.show(commentTargetAt(view.file.path, content, line, reviewsFolder(data.settings.projectsLocation)));
	}
	plugin.registerInterval(window.setInterval(() => void followCursor(), CURSOR_POLL_MS));
	plugin.registerEvent(app.workspace.on("active-leaf-change", () => void followCursor()));

	async function openPanel() {
		const existing = app.workspace.getLeavesOfType(COMMENT_PANEL_VIEW_TYPE)[0];
		const leaf = existing ?? app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Unable to open the Suivi comments panel");
			return;
		}
		if (!existing) await leaf.setViewState({ type: COMMENT_PANEL_VIEW_TYPE, active: false });
		void app.workspace.revealLeaf(leaf);
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
