import { MarkdownView, Notice, type Plugin, type WorkspaceLeaf } from "obsidian";
import type { CommentTarget } from "../comments/commentTarget";
import { obsidianTransport } from "../remote/obsidianTransport";
import { createHttpRemote } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import type { PluginData } from "../sync/pluginData";
import type { PullHooks } from "../sync/registerPull";
import { vaultFiles } from "../sync/registerPull";
import { INBOX_VIEW_TYPE, InboxView } from "../views/InboxView";
import { withInboxNotice } from "./inboxNotice";
import { InboxStore, type InboxEntry, type InboxState } from "./inboxStore";
import { itemLocation } from "./itemLocation";

export interface InboxDeps {
	/** Opens the comment panel on an item's thread. */
	openThread(target: CommentTarget): Promise<void>;
}

/**
 * Inbox view (command "Open Suivi inbox"): Client comments, priority changes
 * and Pull conflicts. Reloads from the app after a Pull that brought such
 * events; returns the store (for the kanban dots) and the Pull hooks.
 */
export function registerInbox(plugin: Plugin, data: PluginData<ProjectsTimerSettings>, deps: InboxDeps) {
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
	const listeners = new Set<(state: InboxState) => void>();
	const store = new InboxStore(remote, () => data.sync.conflicts, (state) => listeners.forEach((l) => l(state)));
	const subscribe = (listener: (state: InboxState) => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};

	async function open(entry: InboxEntry) {
		const at = await itemLocation(data.sync, vaultFiles(plugin), entry.item);
		if (at) await openLine(at.path, at.line);
		else if (entry.kind !== "comment") new Notice(`${entry.item.title} is not in this vault.`);
		if (entry.kind === "comment" && entry.item.kind !== "review") {
			await deps.openThread({ kind: entry.item.kind, id: entry.item.id, title: entry.item.title });
		}
	}

	async function openLine(path: string, line: number) {
		const file = app.vault.getFileByPath(path);
		if (!file) return;
		const existing = app.workspace
			.getLeavesOfType("markdown")
			.find((leaf) => (leaf.view as MarkdownView).file?.path === path);
		const leaf = existing ?? app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		const view = leaf.view instanceof MarkdownView ? leaf.view : null;
		view?.editor.setCursor({ line, ch: 0 });
	}

	plugin.registerView(INBOX_VIEW_TYPE, (leaf: WorkspaceLeaf) => new InboxView(leaf, store, subscribe, (e) => void open(e)));

	async function openView() {
		const existing = app.workspace.getLeavesOfType(INBOX_VIEW_TYPE)[0];
		const leaf = existing ?? app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Unable to open the Suivi inbox");
			return;
		}
		if (!existing) await leaf.setViewState({ type: INBOX_VIEW_TYPE, active: true });
		void app.workspace.revealLeaf(leaf);
	}
	plugin.addCommand({ id: "open-suivi-inbox", name: "Open Suivi inbox", callback: () => void openView() });
	plugin.addRibbonIcon("inbox", "Open Suivi inbox", () => void openView());

	let noticed = false;
	const pullHooks: PullHooks = {
		handlers: (base) => withInboxNotice(base, () => (noticed = true)),
		afterPull: () => {
			if (noticed || store.current.status !== "ready") void store.refresh();
			else store.rebuild();
			noticed = false;
		},
	};
	return { store, subscribe, pullHooks, afterPush: () => store.rebuild() };
}
