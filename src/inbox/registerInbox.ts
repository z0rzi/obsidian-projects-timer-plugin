import { MarkdownView, Notice, type Plugin, type WorkspaceLeaf } from "obsidian";
import type { CommentTarget } from "../comments/commentTarget";
import { listeners, settingsRemote } from "../remote/settingsRemote";
import { openView } from "../ui/openView";
import type { ProjectsTimerSettings } from "../settings";
import type { PluginData } from "../sync/pluginData";
import type { PullHooks } from "../sync/registerPull";
import { vaultFiles } from "../sync/vaultFiles";
import { INBOX_VIEW_TYPE, InboxView } from "../views/InboxView";
import { withInboxNotice } from "./inboxNotice";
import { InboxStore, type InboxEntry, type InboxState } from "./inboxStore";
import { itemLocation } from "./itemLocation";
import { placeLine, runTriage, type TriageChoice } from "./triage";
import { tagTaskProject } from "../sync/taskProject";
import { TriageModal } from "../ui/TriageModal";
import { NewProjectModal } from "../ui/NewProjectModal";
import { runNewProject } from "./newProject";
import { toastText } from "./signals";

export interface InboxDeps {
	/** Opens the comment panel on an item's thread. */
	openThread(target: CommentTarget): Promise<void>;
}

/**
 * Inbox view (command "Open Suivi inbox"): Tickets to triage ("Insérer ici"), launched Ideas ("Nouveau projet"),
 * Pull conflicts and the Activity feed. Reloads from the app after a Pull that brought any event and toasts the
 * Client's new ones; a status bar item shows the unread count. Returns the store (for the kanban), the Pull hooks
 * and `openOnItem` (kanban badges).
 */
export function registerInbox(plugin: Plugin, data: PluginData<ProjectsTimerSettings>, deps: InboxDeps) {
	const { app } = plugin;
	const remote = settingsRemote(data.settings);
	const { emit, subscribe } = listeners<InboxState>();
	const store = new InboxStore(remote, () => data.sync.conflicts, emit);

	/** Opens the file at the item's line; `thread` also opens its comment thread. Nothing is marked read. */
	async function open(item: InboxEntry["item"] | undefined, title: string, thread: boolean) {
		// An entry the app sent without an item (archived, or a Push line) must not break the panel.
		if (!item) {
			new Notice(`${title}: nothing to open.`);
			return;
		}
		const at = await itemLocation(data.sync, vaultFiles(app), item);
		if (at) await openLine(at.path, at.line);
		else if (!thread) new Notice(`${item.title} is not in this vault.`);
		if (thread) await deps.openThread({ kind: item.kind, id: item.id, title: item.title });
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
				} else new Notice(`New project failed: ${result.error}`, 10_000);
				await store.refresh();
			})();
		}).open();
	}

	plugin.registerView(
		INBOX_VIEW_TYPE,
		(leaf: WorkspaceLeaf) =>
			new InboxView(
				leaf,
				store,
				subscribe,
				(item, title, thread) => void open(item, title, thread),
				() => data.settings.suiviUrl,
				(path) => remote.image(path),
				triage,
				newProject,
			),
	);

	const openInbox = () => void openView(app, INBOX_VIEW_TYPE, "Suivi inbox", { active: true }, InboxView);
	plugin.addCommand({ id: "open-suivi-inbox", name: "Open Suivi inbox", callback: openInbox });
	plugin.addRibbonIcon("inbox", "Open Suivi inbox", openInbox);

	/** Opens the Inbox with the feed narrowed to one item (its title taken from its unread entries). */
	function openOnItem(itemId: string) {
		const title = store.unreadByItem().get(itemId)?.[0]?.item?.title ?? itemId;
		store.setItemFilter({ id: itemId, title });
		openInbox();
	}

	const statusItem = plugin.addStatusBarItem();
	statusItem.addClass("mod-clickable");
	statusItem.onclick = openInbox;
	const showUnread = (state: InboxState) => {
		statusItem.setText(`Suivi : ${state.unread}`);
		statusItem.toggle(state.unread > 0);
	};
	subscribe(showUnread);
	showUnread(store.current);

	let noticed = false;
	/** Ids of the events the running Pull brought, to toast once the feed has them. */
	const pulled = new Set<number>();
	const pullHooks: PullHooks = {
		handlers: (base) =>
			withInboxNotice(base, (event) => {
				noticed = true;
				// No cursor yet: the first Pull after install brings the whole history, not news.
				// Events at or below the cursor are retries, toasted when they first came.
				const cursor = data.sync.cursor;
				if (cursor !== undefined && event.id > cursor) pulled.add(event.id);
			}),
		afterPull: () => {
			if (!noticed && store.current.status === "ready") return store.rebuild();
			noticed = false;
			const toToast = new Set(pulled);
			pulled.clear();
			void store.refresh().then(() => {
				// New Client events are unread; the Developer's own never are, so they get no toast.
				const entries = [...store.unreadByItem().values()].flat().filter((e) => toToast.has(e.id));
				for (const entry of entries.sort((a, b) => a.id - b.id)) new Notice(toastText(entry));
			});
		},
	};
	return { store, subscribe, pullHooks, openOnItem, afterPush: () => store.rebuild() };
}
