import { Component, ItemView, MarkdownRenderer, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { AppImages } from "../comments/appImages";
import { highlightMentions, uploadedImages, withAppUrls } from "../comments/commentMarkdown";
import type { InboxEntry, InboxFilter, InboxState, InboxStore } from "../inbox/inboxStore";
import type { ActivityEntry, EventType } from "../remote/api";
import type { Conflict } from "../sync/compareState";

export const INBOX_VIEW_TYPE = "suivi-inbox-view";

const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const EXCERPT = 160;

const FILTERS: { filter: InboxFilter; label: string }[] = [
	{ filter: "all", label: "Tous" },
	{ filter: "client", label: "JMJ" },
	{ filter: "developer", label: "Moi" },
];

/** What the pane shows: what needs the Developer, or the whole log. */
export type InboxMode = "inbox" | "activity";

const MODES: { mode: InboxMode; label: string }[] = [
	{ mode: "inbox", label: "Inbox" },
	{ mode: "activity", label: "Activité" },
];

/** A feed entry as `mode` shows it. */
export interface FeedLine {
	entry: ActivityEntry;
	/** Read, in the Activity: drawn faded. */
	dimmed: boolean;
}

/** The feed entries `mode` lists: the Inbox keeps the unread ones, the Activity all of them, the read ones dimmed. */
export function feedLines(feed: ActivityEntry[], mode: InboxMode): FeedLine[] {
	return feed.filter((entry) => mode === "activity" || entry.unread).map((entry) => ({ entry, dimmed: !entry.unread }));
}

/** Loaded, with nothing pinned and no unread entry shown: the Inbox says « Rien à traiter ». */
export function nothingToHandle(state: InboxState): boolean {
	return (
		state.status === "ready" &&
		state.toTriage.length === 0 &&
		state.conflicts.length === 0 &&
		!state.feed.some((entry) => entry.unread)
	);
}

/** Lucide icon of each event type. */
const TYPE_ICONS: Record<EventType, string> = {
	"project.created": "folder-plus",
	"task.created": "square-plus",
	"item.updated": "arrow-up-down",
	"item.archived": "archive",
	"ticket.created": "ticket",
	"idea.launched": "lightbulb",
	"item.triaged": "inbox",
	"item.answered": "circle-check",
	"comment.created": "message-square",
	"comment.edited": "message-square",
	"comment.deleted": "message-square-x",
	"push.completed": "upload",
};

/** The two buttons of a conflict, `[ P0 (moi) ]  [ P1 (jmj) ]`: the value first, who chose it in brackets. */
export function conflictButtons(c: Conflict): { choice: "mine" | "theirs"; text: string }[] {
	return [
		{ choice: "mine", text: `${c.mine.label} (moi)` },
		{ choice: "theirs", text: `${c.theirs.label} (${c.theirs.by ?? "Client"})` },
	];
}

/** What opening something in the Inbox goes to; `thread` also opens its comment thread. */
export type OpenInboxItem = (item: InboxEntry["item"] | undefined, title: string, thread: boolean) => void;

/**
 * The Developer's pane, two views toggled in its header (kept in the view
 * state). The Inbox: Tickets À trier ("Insérer ici", launched Ideas "Nouveau
 * projet") and conflicts (each button settles one at once), then the unread feed entries; « Lu » or opening
 * one takes it out. The Activity: the whole feed, read entries dimmed. Both
 * newest first, grouped by day. Opening is delegated (`openItem`); filtering,
 * paging and marking read go through the store, so the app keeps the read state.
 */
export class InboxView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	/** Owner of the rendered Markdown of the current draw, unloaded on the next one and on close. */
	private renderScope: Component | null = null;
	/** Uploaded images of comment bodies, fetched with the token while the pane is open. */
	private readonly images: AppImages;
	private mode: InboxMode = "inbox";

	constructor(
		leaf: WorkspaceLeaf,
		private readonly store: InboxStore,
		private readonly subscribe: (listener: (state: InboxState) => void) => () => void,
		private readonly openItem: OpenInboxItem,
		private readonly appUrl: () => string,
		fetchImage: ConstructorParameters<typeof AppImages>[0],
		/** "Insérer ici" on an entry À trier. */
		private readonly triage: (entry: InboxEntry) => void = () => {},
		/** "Nouveau projet" on a launched Idea À trier. */
		private readonly newProject: (entry: InboxEntry) => void = () => {},
		/** A conflict's button. */
		private readonly pick: (conflict: Conflict, choice: "mine" | "theirs") => void = () => {},
	) {
		super(leaf);
		this.images = new AppImages(fetchImage);
	}

	getViewType(): string {
		return INBOX_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Suivi inbox";
	}

	getIcon(): string {
		return "inbox";
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), mode: this.mode };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const mode = (state as { mode?: unknown } | null)?.mode;
		if (mode === "inbox" || mode === "activity") this.mode = mode;
		await super.setState(state, result);
		this.render(this.store.current);
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("suivi-inbox");
		this.unsubscribe = this.subscribe((state) => this.render(state));
		// Draw before rebuilding so the pane is never blank if the store's rebuild throws.
		this.render(this.store.current);
		this.store.rebuild();
		if (this.store.current.status === "idle") void this.store.refresh();
	}

	async onClose() {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.releaseRenderScope();
		this.images.clear();
	}

	/** Redraws the pane; a failure is written into it instead of leaving it blank. */
	private render(state: InboxState) {
		const root = this.contentEl;
		root.empty();
		this.releaseRenderScope();
		this.renderScope = this.addChild(new Component());
		try {
			this.draw(root, state);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			root.createEl("p", { text: `Affichage de la boîte Suivi impossible : ${message}`, cls: "mod-warning" });
		}
	}

	private releaseRenderScope() {
		if (this.renderScope) this.removeChild(this.renderScope);
		this.renderScope = null;
	}

	private draw(root: HTMLElement, state: InboxState) {
		this.drawHeader(root, state);
		if (state.error) root.createEl("p", { text: state.error, cls: "mod-warning" });
		if (state.status === "loading") root.createEl("p", { text: "Chargement…" });

		if (this.mode === "inbox") this.drawPinned(root, state);

		const feed = root.createDiv({ cls: "suivi-inbox-section", attr: { "data-section": "feed" } });
		if (this.mode === "inbox" && nothingToHandle(state)) {
			feed.createEl("p", { text: "Rien à traiter", cls: "suivi-inbox-empty" });
		} else if (this.mode === "activity" && state.status === "ready" && state.feed.length === 0) {
			feed.createEl("p", { text: "Rien de nouveau.", cls: "suivi-inbox-empty" });
		}
		let day = "";
		for (const { entry, dimmed } of feedLines(state.feed, this.mode)) {
			const entryDay = DAY.format(new Date(entry.at));
			if (entryDay !== day) feed.createEl("h5", { text: entryDay, cls: "suivi-inbox-day" });
			day = entryDay;
			this.renderActivity(feed, entry, dimmed);
		}
		if (state.more) feed.createEl("button", { text: "Charger plus" }).onclick = () => void this.store.loadMore();
	}

	/** The Inbox's pinned sections, each drawn only when it has entries (ticket 10 adds « Hors du vault » after À trier). */
	private drawPinned(root: HTMLElement, state: InboxState) {
		const sections = [
			{ id: "to-triage", title: "À trier", entries: state.toTriage },
			{ id: "conflicts", title: "Conflits", entries: state.conflicts },
		];
		for (const { id, title, entries } of sections) {
			if (entries.length === 0) continue;
			const section = this.section(root, id, `${title} (${entries.length})`);
			for (const entry of entries) this.renderPinned(section, entry);
		}
	}

	/** Switches between the Inbox and the Activity; Obsidian saves the choice with the view state. */
	private setMode(mode: InboxMode) {
		this.mode = mode;
		this.app.workspace.requestSaveLayout();
		this.render(this.store.current);
	}

	/** Title, Inbox / Activité toggle, filter, item filter (its button clears it), "Tout marquer comme lu" and the reload icon. */
	private drawHeader(root: HTMLElement, state: InboxState) {
		const header = root.createDiv({ cls: "suivi-inbox-header" });
		header.style.display = "flex";
		header.style.flexWrap = "wrap";
		header.style.gap = "4px";
		header.style.alignItems = "center";
		header.createEl("h4", { text: "Suivi inbox" }).style.flexGrow = "1";
		for (const { mode, label } of MODES) {
			const button = header.createEl("button", { text: label });
			if (mode === this.mode) button.addClass("mod-cta");
			button.onclick = () => this.setMode(mode);
		}
		const reload = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Recharger" } });
		setIcon(reload, "refresh-cw");
		reload.onclick = () => void this.store.refresh();

		const tools = root.createDiv({ cls: "suivi-inbox-tools" });
		tools.style.display = "flex";
		tools.style.gap = "4px";
		for (const { filter, label } of FILTERS) {
			const button = tools.createEl("button", { text: label });
			if (filter === state.filter) button.addClass("mod-cta");
			button.onclick = () => this.store.setFilter(filter);
		}
		if (state.item) {
			const clear = tools.createEl("button", {
				text: `${state.item.title} ✕`,
				cls: "mod-cta",
				attr: { "aria-label": "Afficher tous les éléments" },
			});
			clear.onclick = () => this.store.setItemFilter(null);
		}
		if (state.unread > 0) {
			const all = tools.createEl("button", { text: `Tout marquer comme lu (${state.unread})` });
			all.style.marginLeft = "auto";
			all.onclick = () => void this.store.markAllRead();
		}
	}

	private section(root: HTMLElement, id: string, title: string): HTMLElement {
		const el = root.createDiv({ cls: "suivi-inbox-section", attr: { "data-section": id } });
		el.createEl("h5", { text: title });
		return el;
	}

	/** A Ticket À trier or a conflict, with its buttons. */
	private renderPinned(parent: HTMLElement, entry: InboxEntry) {
		const el = this.entryBox(parent, entry.kind);
		this.link(el, entry.title, () => this.openItem(entry.item, entry.title, entry.kind === "ticket"));
		const meta = [entry.by, entry.at && DATE.format(new Date(entry.at))].filter(Boolean).join(" · ");
		if (meta) el.createDiv({ text: meta, cls: "suivi-inbox-meta" }).style.color = "var(--text-faint)";
		const detail = entry.detail.length > EXCERPT ? `${entry.detail.slice(0, EXCERPT)}…` : entry.detail;
		el.createDiv({ text: detail, cls: "suivi-inbox-detail" }).style.whiteSpace = "pre-wrap";
		if (entry.conflict) {
			const conflict = entry.conflict;
			for (const { choice, text } of conflictButtons(conflict)) {
				const button = el.createEl("button", { text });
				button.onclick = () => {
					button.disabled = true;
					this.pick(conflict, choice);
				};
			}
		} else if (entry.kind === "ticket" && entry.ticketType === "idea") {
			el.createEl("button", {
				text: "Nouveau projet",
				attr: { "aria-label": "Créer la note du Projet depuis le modèle" },
			}).onclick = () => this.newProject(entry);
		} else if (entry.kind === "ticket") {
			const insert = el.createEl("button", {
				text: "Insérer ici",
				attr: { "aria-label": "Écrire cette Tâche au curseur de la note ouverte" },
			});
			// Keep the note's cursor: the button must not take focus from the editor first.
			insert.onmousedown = (e) => e.preventDefault();
			insert.onclick = () => this.triage(entry);
		}
	}

	/**
	 * An entry of the feed: type icon, actor, time, label, item title, comment
	 * body; "Lu" while unread. A comment that mentions the Developer stands out;
	 * a `dimmed` one is faded. Opening an unread entry marks it read.
	 */
	private renderActivity(parent: HTMLElement, entry: ActivityEntry, dimmed: boolean) {
		const el = this.entryBox(parent, entry.type);
		if (dimmed) {
			el.addClass("is-read");
			el.style.opacity = "0.6";
		}
		if (entry.unread) {
			el.addClass("is-unread");
			el.style.background = "var(--background-modifier-hover)";
			el.style.borderLeft = "3px solid var(--interactive-accent)";
			el.style.paddingLeft = "6px";
		}
		if (entry.comment?.mentioned) el.addClass("is-mention");
		const line = el.createDiv({ cls: "suivi-inbox-line" });
		line.style.display = "flex";
		line.style.gap = "6px";
		line.style.alignItems = "center";
		// An Answer À reprendre sends the work back: not the Validé tick.
		const icon = entry.answer === "a_reprendre" ? "rotate-ccw" : (TYPE_ICONS[entry.type] ?? "circle");
		setIcon(line.createSpan({ cls: "suivi-inbox-icon" }), icon);
		line.createEl("strong", { text: entry.actor.handle ? `@${entry.actor.handle}` : entry.actor.email });
		line.createSpan({ text: TIME.format(new Date(entry.at)), cls: "suivi-inbox-meta" }).style.color = "var(--text-faint)";
		line.createSpan({ text: entry.label }).style.flexGrow = "1";
		if (entry.unread) {
			line.createEl("button", { text: "Lu" }).onclick = (e) => {
				e.stopPropagation();
				void this.store.markRead(entry);
			};
		}
		const thread = entry.type.startsWith("comment.");
		if (entry.item) {
			this.link(el, entry.item.title, () => {
				void this.store.markRead(entry);
				this.openItem(entry.item, entry.label, thread);
			});
		}
		const { comment } = entry;
		if (comment?.body) {
			this.renderMarkdown(el.createDiv({ cls: "suivi-inbox-body" }), highlightMentions(comment.body, comment.mentions));
		}
	}

	/** `markdown` rendered into `el`, uploaded images swapped for local copies once fetched (as in the comment panel). */
	private renderMarkdown(el: HTMLElement, markdown: string) {
		const scope = this.renderScope ?? this;
		const show = (images?: Map<string, string>) => {
			el.empty();
			void MarkdownRenderer.render(this.app, withAppUrls(markdown, this.appUrl(), images), el, "", scope);
		};
		show();
		const paths = uploadedImages(markdown);
		if (paths.length > 0) {
			void this.images.urls(paths).then((images) => {
				if (images.size > 0 && el.isConnected) show(images);
			});
		}
	}

	private entryBox(parent: HTMLElement, kind: string): HTMLElement {
		const el = parent.createDiv({ cls: "suivi-inbox-entry", attr: { "data-kind": kind } });
		el.style.borderTop = "1px solid var(--background-modifier-border)";
		el.style.padding = "6px 0";
		return el;
	}

	private link(parent: HTMLElement, text: string, onClick: () => void) {
		parent.createEl("a", { text, href: "#" }).onclick = (e) => {
			e.preventDefault();
			onClick();
		};
	}
}
