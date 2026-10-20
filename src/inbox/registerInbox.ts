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
import { placeLine, runTriage, type TriageChoice } from "./triage";
import { tagTaskProject } from "../sync/taskProject";
import { TriageModal } from "../ui/TriageModal";
import { NewProjectModal } from "../ui/NewProjectModal";
import { runNewProject } from "./newProject";

export interface InboxDeps {
	/** Opens the comment panel on an item's thread. */
	openThread(target: CommentTarget): Promise<void>;
}

/**
 * Inbox view (command "Open Suivi inbox"): Tickets to triage ("Insérer ici"), launched Ideas ("Nouveau projet"),
 * Client comments, priority changes and Pull conflicts. Reloads from the app after a Pull that brought such
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
		else if (entry.kind !== "comment" && entry.kind !== "ticket" && entry.kind !== "answer") {
			new Notice(`${entry.item.title} is not in this vault.`);
		}
		if (entry.kind === "comment" || entry.kind === "ticket" || entry.kind === "answer") {
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

	/** The note last edited (the Inbox has focus when its button is clicked). */
	function noteView(): MarkdownView | null {
		const leaf = app.workspace.getMostRecentLeaf();
		return leaf?.view instanceof MarkdownView && leaf.view.file ? leaf.view : null;
	}

	/** Note and Project the line goes to, with the same Project rule as the Push. */
	function triageTarget(view: MarkdownView | null) {
		const file = view?.file;
		if (!view || !file) return { error: "Open the note where the Task goes and put the cursor there." };
		if (file.path === data.settings.projectTemplate) return { error: "That is the Project template." };
		const projectPath = tagTaskProject(app, file, view.editor.getValue());
		const projectFile = projectPath ? app.vault.getFileByPath(projectPath) : null;
		const folder = data.settings.projectsLocation.replace(/\/+$/, "");
		if (!projectFile || projectFile.parent?.path !== folder) return { path: file.path, projectId: null };
		const fm = app.metadataCache.getFileCache(projectFile)?.frontmatter as Record<string, unknown> | undefined;
		if (fm?.prive === true) return { error: `${projectFile.basename} is private: the Client would lose this Task.` };
		// Not pushed yet: the next Push links the Task once the Project has its id.
		return { path: file.path, projectId: typeof fm?.suivi_id === "string" ? fm.suivi_id : null };
	}

	function triage(entry: InboxEntry) {
		const view = noteView();
		if (!view) {
			new Notice("Open the note where the Task goes and put the cursor there.");
			return;
		}
		new TriageModal(app, { title: entry.item.title, type: entry.ticketType ?? "task" }, (choice: TriageChoice) => {
			void (async () => {
				const result = await data.exclusive(() =>
					runTriage(entry.item, choice, {
						remote,
						sync: data.sync,
						save: () => data.save(),
						target: () => triageTarget(view),
						insert: (line) => {
							const editor = view.editor;
							const lines = editor.getValue().split("\n");
							const at = placeLine(lines, editor.getCursor().line, line);
							editor.replaceRange(at.text, at.from, at.to);
						},
					}),
				);
				if (result.ok) new Notice(`Inserted: ${result.line}`);
				else new Notice(`Triage failed: ${result.error}`, 10_000);
				await store.refresh();
			})();
		}).open();
	}

	function newProject(entry: InboxEntry) {
		new NewProjectModal(app, entry.item, (choice) => {
			void (async () => {
				const result = await data.exclusive(() =>
					runNewProject(entry.item, choice, {
						remote,
						sync: data.sync,
						save: () => data.save(),
						folder: data.settings.projectsLocation,
						template: async () => {
							const path = data.settings.projectTemplate;
							const file = path ? app.vault.getFileByPath(path) : null;
							return file ? app.vault.read(file) : "";
						},
						exists: (path) => app.vault.getAbstractFileByPath(path) !== null,
						create: async (path, content) => {
							await app.vault.create(path, content);
						},
					}),
				);
				if (result.ok) {
					new Notice(`Created ${result.path}`);
					await openLine(result.path, 0);
				} else new Notice(`Nouveau projet failed: ${result.error}`, 10_000);
				await store.refresh();
			})();
		}).open();
	}

	plugin.registerView(
		INBOX_VIEW_TYPE,
		(leaf: WorkspaceLeaf) => new InboxView(leaf, store, subscribe, (e) => void open(e), triage, newProject),
	);

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
