import { MarkdownView, Notice, type Plugin, type WorkspaceLeaf } from "obsidian";
import type { CommentTarget } from "../comments/commentTarget";
import { listeners, settingsRemote } from "../remote/settingsRemote";
import { openView } from "../ui/openView";
import type { ProjectsTimerSettings } from "../settings";
import type { AppItems } from "../sync/appState";
import type { Conflict } from "../sync/compareState";
import { pickConflict } from "../sync/conflicts";
import type { PluginData } from "../sync/pluginData";
import type { PullOutcome } from "../sync/runPull";
import { vaultFiles } from "../sync/vaultFiles";
import { INBOX_VIEW_TYPE, InboxView } from "../views/InboxView";
import { InboxStore, type InboxEntry, type InboxState, type VaultProject } from "./inboxStore";
import { itemLocation } from "./itemLocation";
import { firstStepTarget, insertUnplacedTask, placeFirstStep, placeLine, runTriage, type TriageChoice, type TriageDeps } from "./triage";
import { removeFromApp, type UnplacedItem } from "../sync/unplaced";
import { tagTaskProject } from "../sync/taskProject";
import { findTasksHeadingSection } from "../projectCards";
import { suiviIdOf } from "../suiviId";
import { TriageModal } from "../ui/TriageModal";
import { NewProjectModal } from "../ui/NewProjectModal";
import { insertUnplacedProject, runNewProject, type NewProjectDeps } from "./newProject";
import { badgeText, toastText } from "./signals";

export interface InboxDeps {
	/** Opens the comment panel on an item's thread. */
	openThread(target: CommentTarget): Promise<void>;
}

/**
 * Inbox view (command "Open Suivi inbox"): Tickets to triage ("Insérer ici", « Insérer dans <Projet> »), launched Ideas ("Nouveau projet"),
 * the Unplaced items and conflicts of the last Pull and the Activity feed. Reloads from the app after each Pull and toasts the
 * Client's entries that are new since the previous reload; a status bar item shows the unread count. Returns
 * the store, `subscribe`, `badges` and `openOnItem` (for the kanban), `pick` (a conflict's buttons) and `afterPull`.
 */
export function registerInbox(plugin: Plugin, data: PluginData<ProjectsTimerSettings>, deps: InboxDeps) {
	const { app } = plugin;
	const remote = settingsRemote(data.settings);
	const { emit, subscribe } = listeners<InboxState>();
	const store = new InboxStore(remote, emit, () => {
		const projects = new Map<string, VaultProject>();
		for (const note of app.vault.getMarkdownFiles()) {
			const id = suiviIdOf(app, note.path);
			if (!id) continue;
			const fm = app.metadataCache.getFileCache(note)?.frontmatter as Record<string, unknown> | undefined;
			projects.set(id, { id, path: note.path, title: note.basename, private: fm?.prive === true });
		}
		return projects;
	});
	/** The app's state at the last Pull: the base's note is where an item is looked for first. */
	let lastState: AppItems | null = null;

	/** Opens the file at the item's line; `thread` also opens its comment thread. Nothing is marked read. */
	async function open(item: InboxEntry["item"] | undefined, title: string, thread: boolean) {
		// An entry the app sent without an item (archived, or a Push line) must not break the panel.
		if (!item) {
			new Notice(`${title} : rien à ouvrir.`);
			return;
		}
		const base = item.kind === "project" ? lastState?.projects[item.id]?.base : lastState?.tasks[item.id]?.base;
		const at = await itemLocation(vaultFiles(app), item, base?.path);
		if (at) await openLine(at.path, at.line);
		else if (!thread) new Notice(`${item.title} n'est pas dans ce coffre.`);
		if (thread) await deps.openThread({ kind: item.kind, id: item.id, title: item.title });
	}

	async function openLine(path: string, line: number) {
		const view = await openNote(path, line);
		view?.editor.setCursor({ line, ch: 0 });
	}

	/** Opens the note at `path` (in its tab if open) at `line` and focuses it; its view, null when not a note. */
	async function openNote(path: string, line: number): Promise<MarkdownView | null> {
		const file = app.vault.getFileByPath(path);
		if (!file) return null;
		const existing = app.workspace
			.getLeavesOfType("markdown")
			.find((leaf) => (leaf.view as MarkdownView).file?.path === path);
		const leaf = existing ?? app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		return leaf.view instanceof MarkdownView ? leaf.view : null;
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
		return { path: file.path, projectId: suiviIdOf(app, projectFile.path) ?? null, step };
	}

	/** Writes `text` at the cursor of `view` as Triage places a Task line. */
	function insertAtCursor(view: MarkdownView, text: string) {
		const editor = view.editor;
		const at = placeLine(editor.getValue().split("\n"), editor.getCursor().line, text);
		editor.replaceRange(at.text, at.from, at.to);
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
		const item = { title: entry.item.title, type: entry.ticketType ?? "task", step: target.step, context: entry.context, urgency: entry.urgency };
		new TriageModal(app, item, (choice: TriageChoice) => {
			void (async () => {
				await triageWith(entry, choice, target.path, {
					target: () => target,
					insert: (line) => insertAtCursor(view, line),
				});
				await store.refresh();
			})();
		}).open();
	}

	/** Runs the Triage of `entry` into the note at `path` and tells how it went. */
	async function triageWith(entry: InboxEntry, choice: TriageChoice, path: string, where: Pick<TriageDeps, "target" | "insert">) {
		const result = await data.exclusive(() =>
			runTriage(entry.item, choice, {
				remote,
				...where,
				appUrl: data.settings.suiviUrl,
				localImage: (url) => copyAppImage(url, path),
			}),
		);
		if (!result.ok) new Notice(`Échec du tri : ${result.error}`, 10_000);
		else {
			new Notice(`Insérée : ${result.line}`);
			if (result.missingImages > 0) {
				new Notice(`${result.missingImages} image(s) du ticket non copiée(s) dans le coffre : le lien vers l'app est gardé.`, 10_000);
			}
		}
	}

	/**
	 * « Insérer dans <Projet> »: the Ticket triaged as a step of the Client's Project, written
	 * first under its Tasks heading, then the cursor put at the end of that line. A note
	 * without a Tasks heading gets a Notice and nothing is triaged.
	 */
	function insertInto(entry: InboxEntry) {
		const project = entry.context?.project;
		if (!project) return;
		const item = { title: entry.item.title, type: entry.ticketType ?? "task", step: true, context: entry.context, into: project.title, urgency: entry.urgency };
		new TriageModal(app, item, (choice: TriageChoice) => {
			void (async () => {
				const view = await openNote(project.path, 0);
				if (!view) return;
				const { editor } = view;
				await triageWith(entry, choice, project.path, {
					// Checked on the buffer the step is written into, before the app is called.
					target: () => firstStepTarget(editor.getValue().split("\n"), project),
					insert: (text) => {
						const at = placeFirstStep(editor.getValue().split("\n"), text);
						if (!at) throw new Error(`${project.title} n'a plus de titre « Tasks »`);
						editor.replaceRange(at.text, at.from, at.to);
						const end = { line: at.line, ch: editor.getLine(at.line).length };
						editor.setCursor(end);
						editor.scrollIntoView({ from: end, to: end }, true);
					},
				});
				await store.refresh();
			})();
		}).open();
	}

	/** Where and how a Project file is created from the template. */
	function projectDeps(): NewProjectDeps {
		return {
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
			appUrl: data.settings.suiviUrl,
			localImage: copyAppImage,
		};
	}

	/**
	 * « Insérer ici » on an Unplaced item: a Task's line at the cursor of the note last
	 * edited (as Triage places it), a Project's file from the template; it then leaves the Inbox.
	 */
	async function insertUnplaced(item: UnplacedItem): Promise<void> {
		const failed = (error: string): void => void new Notice(`Échec de l'insertion : ${error}`, 10_000);
		if (item.kind === "project") {
			const result = await data.exclusive(() => insertUnplacedProject(item, projectDeps()));
			if (!result.ok) return failed(result.error);
			new Notice(`Créée : ${result.path}`);
			await openLine(result.path, 0);
		} else {
			const view = noteView();
			if (!view) return failed("ouvrez la note où va la Tâche et placez-y le curseur.");
			const result = await data.exclusive(() =>
				insertUnplacedTask(item, {
					remote,
					target: () => triageTarget(view),
					insert: (line) => insertAtCursor(view, line),
					appUrl: data.settings.suiviUrl,
					// noteView only returns a view with a file.
					localImage: (url) => copyAppImage(url, view.file!.path),
				}),
			);
			if (!result.ok) return failed(result.error);
			new Notice(`Insérée : ${result.line}`);
		}
		store.dropUnplaced([item.id]);
	}

	/** « Retirer de l'app »: archives the Items; the ones archived leave the Inbox, a failure gets a Notice. */
	async function removeUnplaced(items: UnplacedItem[]) {
		try {
			const { removed, failed } = await data.exclusive(() => removeFromApp(remote, items));
			store.dropUnplaced(removed);
			for (const f of failed) new Notice(`Retrait impossible : ${f}`, 10_000);
		} catch (e) {
			new Notice(`Retrait impossible : ${(e as Error).message}`, 10_000);
		}
	}

	function newProject(entry: InboxEntry) {
		new NewProjectModal(app, entry.item, (choice) => {
			void (async () => {
				const result = await data.exclusive(() => runNewProject(entry.item, choice, projectDeps()));
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
				insertInto,
				newProject,
				(conflict, choice) => void pick(conflict, choice),
				{ insert: (item) => void insertUnplaced(item), remove: (items) => void removeUnplaced(items) },
				{ push: () => runCommand("push-to-suivi"), pull: () => runCommand("pull-from-suivi") },
			),
	);

	/** Runs one of this plugin's commands, as the command palette does (Push and Pull are registered after the Inbox). */
	function runCommand(id: string) {
		(app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(
			`${plugin.manifest.id}:${id}`,
		);
	}

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

	/** Settles a conflict at once (Inbox or Push review); false, with a Notice, when it failed. */
	async function pick(conflict: Conflict, choice: "mine" | "theirs"): Promise<boolean> {
		try {
			await data.exclusive(() => pickConflict(conflict, choice, { remote, files: vaultFiles(app) }));
			store.dropConflict(conflict.key);
			return true;
		} catch (e) {
			new Notice(`Conflit sur ${conflict.title} : ${(e as Error).message}`, 10_000);
			store.rebuild();
			return false;
		}
	}

	/** After each Pull: its Unplaced items, conflicts and state, then the feed reloaded and the Client's new entries toasted. */
	function afterPull(outcome: PullOutcome) {
		lastState = outcome.app;
		store.setUnplaced(outcome.unplaced);
		store.setConflicts(outcome.conflicts);
		void store.refresh().then((fresh) => {
			for (const entry of fresh) new Notice(toastText(entry));
		});
	}

	/** Kanban badge text by app id of the items with unread Inbox entries. */
	const badges = () => new Map([...store.unreadByItem()].map(([id, entries]) => [id, badgeText(entries)]));
	return { store, subscribe, badges, pick, afterPull, openOnItem };
}
