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
import { placeLine, runTriage, type TriageChoice, type TriageDeps } from "./triage";
import { tagTaskProject } from "../sync/taskProject";
import { findTasksHeadingSection } from "../projectCards";
import { TriageModal } from "../ui/TriageModal";
import { NewProjectModal } from "../ui/NewProjectModal";
import { runNewProject } from "./newProject";
import { badgeText, toastText } from "./signals";

export interface InboxDeps {
	/** Opens the comment panel on an item's thread. */
	openThread(target: CommentTarget): Promise<void>;
}

/**
 * Inbox view (command "Open Suivi inbox"): Tickets to triage ("Insérer ici"), launched Ideas ("Nouveau projet"),
 * Pull conflicts and the Activity feed. Reloads from the app after a Pull that brought any event and toasts the
 * Client's new ones; a status bar item shows the unread count. Returns the store, `subscribe`, `badges` and
 * `openOnItem` (for the kanban) and the Pull hooks.
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
			new Notice(`${title} : rien à ouvrir.`);
			return;
		}
		const at = await itemLocation(data.sync, vaultFiles(app), item);
		if (at) await openLine(at.path, at.line);
		else if (!thread) new Notice(`${item.title} n'est pas dans ce coffre.`);
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

	/**
	 * Note and Project the line goes to, with the same Project rule as the Push. The cursor
	 * on the Tasks heading or in its section of a Project note makes the line a Project step.
	 */
	function triageTarget(view: MarkdownView | null): ReturnType<TriageDeps["target"]> {
		const file = view?.file;
		if (!view || !file) return { error: "Ouvrez la note où va la Tâche et placez-y le curseur." };
		if (file.path === data.settings.projectTemplate) return { error: "C'est le modèle de Projet." };
		const content = view.editor.getValue();
		const folder = data.settings.projectsLocation.replace(/\/+$/, "");
		const section = file.parent?.path === folder ? findTasksHeadingSection(content.split("\n")) : null;
		const cursor = view.editor.getCursor().line;
		const step = section !== null && cursor >= section.start - 1 && cursor < section.end;
		const projectPath = step ? file.path : tagTaskProject(app, file, content);
		const projectFile = projectPath ? app.vault.getFileByPath(projectPath) : null;
		if (!projectFile || projectFile.parent?.path !== folder) return { path: file.path, projectId: null, step };
		const fm = app.metadataCache.getFileCache(projectFile)?.frontmatter as Record<string, unknown> | undefined;
		if (fm?.prive === true) return { error: `${projectFile.basename} est privé : le Client perdrait cette Tâche.` };
		// Not pushed yet: the next Push links the Task once the Project has its id.
		return { path: file.path, projectId: typeof fm?.suivi_id === "string" ? fm.suivi_id : null, step };
	}

	/** An app image (`/uploads/…`) fetched with the token into the attachment folder of `notePath`. */
	async function copyAppImage(url: string, notePath: string) {
		const { data } = await remote.image(url);
		const name = url.slice(url.lastIndexOf("/") + 1);
		const path = await app.fileManager.getAvailablePathForAttachment(name, notePath);
		const file = await app.vault.createBinary(path, data);
		return app.metadataCache.fileToLinktext(file, notePath, false);
	}

	function triage(entry: InboxEntry) {
		const view = noteView();
		if (!view) {
			new Notice("Ouvrez la note où va la Tâche et placez-y le curseur.");
			return;
		}
		const target = triageTarget(view);
		if ("error" in target) {
			new Notice(target.error);
			return;
		}
		const item = { title: entry.item.title, type: entry.ticketType ?? "task", step: target.step };
		new TriageModal(app, item, (choice: TriageChoice) => {
			void (async () => {
				const result = await data.exclusive(() =>
					runTriage(entry.item, choice, {
						remote,
						target: () => target,
						insert: (line) => {
							const editor = view.editor;
							const lines = editor.getValue().split("\n");
							const at = placeLine(lines, editor.getCursor().line, line);
							editor.replaceRange(at.text, at.from, at.to);
						},
						localImage: (url) => copyAppImage(url, target.path),
					}),
				);
				if (!result.ok) new Notice(`Échec du tri : ${result.error}`, 10_000);
				else {
					new Notice(`Insérée : ${result.line}`);
					if (result.missingImages > 0) {
						new Notice(`${result.missingImages} image(s) du ticket non copiée(s) dans le coffre : le lien vers l'app est gardé.`, 10_000);
					}
				}
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
					new Notice(`Créée : ${result.path}`);
					await openLine(result.path, 0);
				} else new Notice(`Échec du nouveau projet : ${result.error}`, 10_000);
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
	plugin.registerDomEvent(statusItem, "click", openInbox);
	const showUnread = (state: InboxState) => {
		statusItem.setText(`Suivi : ${state.unread}`);
		statusItem.toggle(state.unread > 0);
	};
	plugin.register(subscribe(showUnread));
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
	/** Kanban badge text by app id of the items with unread Inbox entries. */
	const badges = () => new Map([...store.unreadByItem()].map(([id, entries]) => [id, badgeText(entries)]));
	return { store, subscribe, badges, pullHooks, openOnItem, afterPush: () => store.rebuild() };
}
