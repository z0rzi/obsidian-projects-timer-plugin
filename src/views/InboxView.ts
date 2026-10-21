import { ItemView, MarkdownRenderer, setIcon, type WorkspaceLeaf } from "obsidian";
import { AppImages } from "../comments/appImages";
import { highlightMentions, uploadedImages, withAppUrls } from "../comments/commentMarkdown";
import type { InboxEntry, InboxFilter, InboxState, InboxStore } from "../inbox/inboxStore";
import type { ActivityEntry, EventType } from "../remote/api";

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

/** Lucide icon of each event type. */
const TYPE_ICONS: Record<EventType, string> = {
	"project.created": "folder-plus",
	"task.created": "square-plus",
	"item.updated": "arrow-up-down",
	"item.archived": "archive",
	"ticket.created": "ticket",
	"idea.launched": "lightbulb",
	"item.triaged": "inbox",
	"review.published": "eye",
	"review.answered": "circle-check",
	"comment.created": "message-square",
	"comment.edited": "message-square",
	"comment.deleted": "message-square-x",
	"push.completed": "upload",
};

/** What opening something in the Inbox goes to; `thread` also opens its comment thread. */
export type OpenInboxItem = (item: InboxEntry["item"] | undefined, title: string, thread: boolean) => void;

/**
 * The Developer's Inbox: Tickets À trier ("Insérer ici", launched Ideas
 * "Nouveau projet") and Pull conflicts pinned on top, then the Activity feed
 * newest first, grouped by day. Opening is delegated (`open`); filtering,
 * paging and marking read go through the store, so the app keeps the read state.
 */
export class InboxView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	/** Uploaded images of comment bodies, fetched with the token while the pane is open. */
	private readonly images: AppImages;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly store: InboxStore,
		private readonly subscribe: (listener: (state: InboxState) => void) => () => void,
		private readonly open: OpenInboxItem,
		private readonly appUrl: () => string,
		fetchImage: ConstructorParameters<typeof AppImages>[0],
		/** "Insérer ici" on an entry À trier. */
		private readonly triage: (entry: InboxEntry) => void = () => {},
		/** "Nouveau projet" on a launched Idea À trier. */
		private readonly newProject: (entry: InboxEntry) => void = () => {},
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
		this.images.clear();
	}

	/** Redraws the pane; a failure is written into it instead of leaving it blank. */
	private render(state: InboxState) {
		const root = this.contentEl;
		root.empty();
		try {
			this.draw(root, state);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			root.createEl("p", { text: `Suivi inbox failed to render: ${message}`, cls: "mod-warning" });
		}
	}

	private draw(root: HTMLElement, state: InboxState) {
		this.drawHeader(root, state);
		if (state.error) root.createEl("p", { text: state.error, cls: "mod-warning" });
		if (state.status === "loading") root.createEl("p", { text: "Loading…" });

		const toTriage = this.section(root, "to-triage", `À trier${state.toTriage.length ? ` (${state.toTriage.length})` : ""}`);
		if (state.toTriage.length === 0) toTriage.createEl("p", { text: "Rien à trier.", cls: "suivi-inbox-empty" });
		for (const entry of state.toTriage) this.renderPinned(toTriage, entry);
		if (state.conflicts.length > 0) {
			const conflicts = this.section(root, "conflicts", `Conflits (${state.conflicts.length})`);
			for (const entry of state.conflicts) this.renderPinned(conflicts, entry);
		}

		const feed = root.createDiv({ cls: "suivi-inbox-section", attr: { "data-section": "feed" } });
		if (state.status === "ready" && state.feed.length === 0) {
			feed.createEl("p", { text: "Rien de nouveau.", cls: "suivi-inbox-empty" });
		}
		let day = "";
		for (const entry of state.feed) {
			const entryDay = DAY.format(new Date(entry.at));
			if (entryDay !== day) feed.createEl("h5", { text: entryDay, cls: "suivi-inbox-day" });
			day = entryDay;
			this.renderActivity(feed, entry);
		}
		if (state.more) feed.createEl("button", { text: "Charger plus" }).onclick = () => void this.store.loadMore();
	}

	/** Title, filter, item filter (its button clears it), "Tout marquer comme lu" and the reload icon. */
	private drawHeader(root: HTMLElement, state: InboxState) {
		const header = root.createDiv({ cls: "suivi-inbox-header" });
		header.style.display = "flex";
		header.style.flexWrap = "wrap";
		header.style.gap = "4px";
		header.style.alignItems = "center";
		header.createEl("h4", { text: "Suivi inbox" }).style.flexGrow = "1";
		const reload = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Reload" } });
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
				attr: { "aria-label": "Show every item" },
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
		this.link(el, entry.title, () => this.open(entry.item, entry.title, entry.kind === "ticket"));
		const meta = [entry.by, entry.at && DATE.format(new Date(entry.at))].filter(Boolean).join(" · ");
		if (meta) el.createDiv({ text: meta, cls: "suivi-inbox-meta" }).style.color = "var(--text-faint)";
		const detail = entry.detail.length > EXCERPT ? `${entry.detail.slice(0, EXCERPT)}…` : entry.detail;
		el.createDiv({ text: detail, cls: "suivi-inbox-detail" }).style.whiteSpace = "pre-wrap";
		if (entry.kind === "ticket" && entry.ticketType === "idea") {
			el.createEl("button", {
				text: "Nouveau projet",
				attr: { "aria-label": "Create the Project file from the template" },
			}).onclick = () => this.newProject(entry);
		} else if (entry.kind === "ticket") {
			const insert = el.createEl("button", {
				text: "Insérer ici",
				attr: { "aria-label": "Write this Task at the cursor of the open note" },
			});
			// Keep the note's cursor: the button must not take focus from the editor first.
			insert.onmousedown = (e) => e.preventDefault();
			insert.onclick = () => this.triage(entry);
		}
	}

	/**
	 * An entry of the feed: type icon, actor, time, label, item title, comment
	 * body; "Lu" while unread. A comment that mentions the Developer stands out.
	 */
	private renderActivity(parent: HTMLElement, entry: ActivityEntry) {
		const el = this.entryBox(parent, entry.type);
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
		setIcon(line.createSpan({ cls: "suivi-inbox-icon" }), TYPE_ICONS[entry.type] ?? "circle");
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
		if (entry.item) this.link(el, entry.item.title, () => this.open(entry.item, entry.label, thread));
		const { comment } = entry;
		if (comment?.body) {
			this.renderMarkdown(el.createDiv({ cls: "suivi-inbox-body" }), highlightMentions(comment.body, comment.mentions));
		}
	}

	/** `markdown` rendered into `el`, uploaded images swapped for local copies once fetched (as in the comment panel). */
	private renderMarkdown(el: HTMLElement, markdown: string) {
		const show = (images?: Map<string, string>) => {
			el.empty();
			void MarkdownRenderer.render(this.app, withAppUrls(markdown, this.appUrl(), images), el, "", this);
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
