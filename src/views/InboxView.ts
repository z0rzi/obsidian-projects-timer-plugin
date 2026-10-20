import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { InboxEntry, InboxState, InboxStore } from "../inbox/inboxStore";

export const INBOX_VIEW_TYPE = "suivi-inbox-view";

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const EXCERPT = 160;

/**
 * What the Client did since the Developer last looked, one block per section
 * of the store. Opening an entry is delegated (`open`); marking read goes
 * through the store, so the app keeps the state.
 */
export class InboxView extends ItemView {
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly store: InboxStore,
		private readonly subscribe: (listener: (state: InboxState) => void) => () => void,
		private readonly open: (entry: InboxEntry) => void,
	) {
		super(leaf);
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
		this.contentEl.addClass("suivi-inbox");
		this.unsubscribe = this.subscribe((state) => this.render(state));
		this.store.rebuild();
		this.render(this.store.current);
		if (this.store.current.status === "idle") void this.store.refresh();
	}

	async onClose() {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private render(state: InboxState) {
		const root = this.contentEl;
		root.empty();
		const header = root.createDiv({ cls: "suivi-inbox-header" });
		header.style.display = "flex";
		header.style.gap = "4px";
		header.style.alignItems = "center";
		header.createEl("h4", { text: "Suivi inbox" }).style.flexGrow = "1";
		const reload = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Reload" } });
		setIcon(reload, "refresh-cw");
		reload.onclick = () => void this.store.refresh();
		const readable = state.sections.some((s) => s.entries.some((e) => e.eventIds.length > 0));
		if (readable) {
			header.createEl("button", { text: "Mark all read" }).onclick = () => void this.store.markAllRead();
		}

		if (state.error) root.createEl("p", { text: state.error, cls: "mod-warning" });
		if (state.status === "loading") root.createEl("p", { text: "Loading…" });

		for (const section of state.sections) {
			const el = root.createDiv({ cls: "suivi-inbox-section", attr: { "data-section": section.id } });
			el.createEl("h5", { text: `${section.title}${section.entries.length ? ` (${section.entries.length})` : ""}` });
			if (section.entries.length === 0) el.createEl("p", { text: "Nothing new.", cls: "suivi-inbox-empty" });
			for (const entry of section.entries) this.renderEntry(el, entry);
		}
	}

	private renderEntry(parent: HTMLElement, entry: InboxEntry) {
		const el = parent.createDiv({ cls: "suivi-inbox-entry", attr: { "data-kind": entry.kind } });
		el.style.borderTop = "1px solid var(--background-modifier-border)";
		el.style.padding = "6px 0";
		const title = el.createEl("a", { text: entry.title, href: "#" });
		title.onclick = (e) => {
			e.preventDefault();
			this.open(entry);
		};
		const meta = [entry.by, entry.at && DATE.format(new Date(entry.at))].filter(Boolean).join(" · ");
		if (meta) el.createDiv({ text: meta, cls: "suivi-inbox-meta" }).style.color = "var(--text-faint)";
		const detail = entry.detail.length > EXCERPT ? `${entry.detail.slice(0, EXCERPT)}…` : entry.detail;
		el.createDiv({ text: detail, cls: "suivi-inbox-detail" }).style.whiteSpace = "pre-wrap";
		if (entry.eventIds.length > 0) {
			el.createEl("button", { text: "Mark read" }).onclick = () => void this.store.markRead(entry);
		}
	}
}
