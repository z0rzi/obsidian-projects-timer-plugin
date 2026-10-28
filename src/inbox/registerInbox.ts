import { MarkdownView, Notice, type Plugin, type WorkspaceLeaf } from "obsidian";
import type { CommentTarget } from "../comments/commentTarget";
import { listeners, settingsRemote } from "../remote/settingsRemote";
import { openView } from "../ui/openView";
import type { ProjectsTimerSettings } from "../settings";
import { frigoCount, type AppItems } from "../sync/appState";
import type { Conflict } from "../sync/compareState";
import { pickConflict } from "../sync/conflicts";
import type { PluginData } from "../sync/pluginData";
import type { PullOutcome } from "../sync/runPull";
import { vaultFiles } from "../sync/vaultFiles";
import { INBOX_VIEW_TYPE, InboxView } from "../views/InboxView";
import { InboxStore, type InboxEntry, type InboxState, type VaultProject } from "./inboxStore";
import { itemLocation } from "./itemLocation";
import { insertUnplacedTask, placeLine, type CursorDeps, type TriageDeps } from "./triage";
import { removeFromApp, type UnplacedItem } from "../sync/unplaced";
import { projectRules } from "../sync/taskProject";
import { noteProject } from "../sync/projectLink";
import { dailyNotePath, dailyNotesOptions } from "../dailyNote";
import { findTasksHeadingSection } from "../projectCards";
import { suiviIdOf } from "../suiviId";
import { registerDeck } from "../deck/registerDeck";
import { obsidianSweep } from "../deck/sweepDeps";
import { bodySharer } from "../sync/bodySharer";
import { insertUnplacedProject, type NewProjectDeps } from "./newProject";
import { runLaunchIdea } from "./launchIdea";
import { badgeText, toastText } from "./signals";

export interface InboxDeps {
	/** Opens the comment panel on an item's thread. */
	openThread(target: CommentTarget): Promise<void>;
}

/**
 * Inbox view (command "Open Suivi inbox"): « Trier (n) » opening the Deck (`../deck/registerDeck.ts`), the Unplaced
 * items and conflicts of the last Pull and the Activity feed; and the command « Lancer en projet » on an `#idea`
 * line. Reloads from the app after each Pull and toasts the Client's entries that are new since the previous reload; a status bar item shows the unread count. Returns
 * the store, `subscribe`, `badges` and `openOnItem` (for the kanban), `pick` (a conflict's buttons) and `afterPull`.
 */
export function registerInbox(plugin: Plugin, data: PluginData<ProjectsTimerSettings>, deps: InboxDeps) {
	const { app } = plugin;
	const remote = settingsRemote(data.settings);
	const { emit, subscribe } = listeners<InboxState>();
	/** The vault's notes with an app id, by that id. */
	function vaultProjects() {
		const projects = new Map<string, VaultProject>();
		for (const note of app.vault.getMarkdownFiles()) {
			const id = suiviIdOf(app, note.path);
			if (!id) continue;
			const fm = app.metadataCache.getFileCache(note)?.frontmatter as Record<string, unknown> | undefined;
			projects.set(id, { id, path: note.path, title: note.basename, private: fm?.prive === true });
		}
		return projects;
	}
	const store = new InboxStore(remote, emit);
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
		const leaf = openLeaf(path) ?? app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		return leaf.view instanceof MarkdownView ? leaf.view : null;
	}

	/** The tab showing the note at `path`, if any. */
	function openLeaf(path: string): WorkspaceLeaf | undefined {
		return app.workspace.getLeavesOfType("markdown").find((leaf) => (leaf.view as MarkdownView).file?.path === path);
	}

	/** The note last edited (the Inbox has focus when its button is clicked). */
	function noteView(): MarkdownView | null {
		const leaf = app.workspace.getMostRecentLeaf();
		return leaf?.view instanceof MarkdownView && leaf.view.file ? leaf.view : null;
	}

	/**
	 * Note the line goes to, refused in a private Project's note (by the Push's
	 * Project rule). The cursor on the Tasks heading or in its section of a
	 * Project note makes the line a Project step.
	 */
	function cursorTarget(view: MarkdownView | null): ReturnType<CursorDeps["target"]> {
		const file = view?.file;
		if (!view || !file) return { error: "Ouvrez la note où va la Tâche et placez-y le curseur." };
		if (file.path === data.settings.projectTemplate) return { error: "C'est le modèle de Projet." };
		const content = view.editor.getValue();
		const rules = projectRules(app, data.settings);
		const section = rules.isProject(file.path) ? findTasksHeadingSection(content.split("\n")) : null;
		const cursor = view.editor.getCursor().line;
		const step = section !== null && cursor >= section.start - 1 && cursor < section.end;
		const projectPath = step ? file.path : noteProject(rules, file.path, content);
		const projectFile = projectPath ? app.vault.getFileByPath(projectPath) : null;
		const fm = projectFile ? (app.metadataCache.getFileCache(projectFile)?.frontmatter as Record<string, unknown> | undefined) : undefined;
		if (projectFile && fm?.prive === true) return { error: `${projectFile.basename} est privé : le Client perdrait cette Tâche.` };
		return { path: file.path, step };
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

	/** The Project notes a Task may join at Triage: in the projects folder, not private, by title. */
	function triageProjects(): VaultProject[] {
		const rules = projectRules(app, data.settings);
		return [...vaultProjects().values()].filter((p) => rules.isProject(p.path) && !p.private).sort((a, b) => a.title.localeCompare(b.title));
	}

	/** How Triage writes a Ticket into today's Daily note (the Deck's Enter). */
	function triageDeps(): TriageDeps {
		const path = dailyNotePath(dailyNotesOptions(app), new Date());
		return {
			remote,
			dailyNote: path,
			heading: data.settings.triageHeading,
			template: async () => {
				const file = data.settings.triageTemplate ? app.vault.getFileByPath(data.settings.triageTemplate) : null;
				return file ? app.vault.read(file) : "";
			},
			write: async (at, edit) => {
				const file = app.vault.getFileByPath(at);
				if (file) return app.vault.process(file, (content) => edit(content));
				const content = edit(null);
				await ensureFolder(at);
				await app.vault.create(at, content);
				return content;
			},
			linkText: (target, source) => {
				const file = app.vault.getFileByPath(target);
				return file ? app.metadataCache.fileToLinktext(file, source, true) : target.replace(/\.md$/, "");
			},
			projects: projectRules(app, data.settings),
			appUrl: data.settings.suiviUrl,
			localImage: (url) => copyAppImage(url, path),
		};
	}

	const openDeck = registerDeck(plugin, {
		remote,
		triage: triageDeps,
		projects: triageProjects,
		exclusive: (task) => data.exclusive(task),
		finished: () => void store.refresh(),
		appUrl: () => data.settings.suiviUrl,
		sweep: () => obsidianSweep(app, data.settings, remote),
	});

	/** Creates the folder of the note at `path` when missing (a Daily notes folder not made yet). */
	async function ensureFolder(path: string) {
		const folder = path.slice(0, Math.max(0, path.lastIndexOf("/")));
		if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
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
					target: () => cursorTarget(view),
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

	/**
	 * « Lancer en projet » on the `#idea` line at the cursor of `view`: its Project note from the template, the
	 * same item in the app, the line gone; then the new note opens, as « Insérer ici » of a Project does.
	 */
	async function launchIdea(view: MarkdownView) {
		const file = view.file;
		if (!file) return;
		const note = { path: file.path, content: view.editor.getValue() };
		const deps = projectDeps();
		const result = await data.exclusive(() =>
			runLaunchIdea(note, view.editor.getCursor().line, {
				...deps,
				remote,
				process: async (path, edit) => {
					const target = app.vault.getFileByPath(path);
					if (!target) throw new Error(`${path} introuvable`);
					await app.vault.process(target, edit);
				},
				shareBody: bodySharer(app, remote),
				projects: projectRules(app, data.settings),
			}),
		);
		if (!result.ok) {
			new Notice(`Échec du lancement en projet : ${result.error}`, 10_000);
			return;
		}
		new Notice(`Créée : ${result.path}`);
		await openLine(result.path, 0);
	}
	plugin.addCommand({
		id: "launch-idea",
		name: "Lancer en projet",
		editorCheckCallback: (checking, editor, ctx) => {
			const view = ctx instanceof MarkdownView ? ctx : null;
			if (!view?.file || !editor.getLine(editor.getCursor().line).startsWith("#idea ")) return false;
			if (!checking) void launchIdea(view);
			return true;
		},
	});

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
				openDeck,
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
		store.setFrigo(frigoCount(outcome.app));
		void store.refresh().then((fresh) => {
			for (const entry of fresh) new Notice(toastText(entry));
		});
	}

	/** Kanban badge text by app id of the items with unread Inbox entries. */
	const badges = () => new Map([...store.unreadByItem()].map(([id, entries]) => [id, badgeText(entries)]));
	return { store, subscribe, badges, pick, afterPull, openOnItem };
}
