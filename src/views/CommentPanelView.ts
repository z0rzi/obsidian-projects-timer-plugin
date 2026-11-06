import { Component, ItemView, MarkdownRenderer, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { AppImages } from "../comments/appImages";
import { highlightMentions, uploadedImages, withAppUrls } from "../comments/commentMarkdown";
import { imagePasteHandler } from "../comments/pasteImages";
import type { ThreadSession, ThreadState } from "../comments/threadSession";
import type { Comment } from "../remote/api";
import { ImageModal } from "../ui/ImageModal";
import type { Remote } from "../remote/remote";

export const COMMENT_PANEL_VIEW_TYPE = "suivi-comments-view";

const KIND_LABELS = { task: "Task", project: "Project" } as const;

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

/**
 * Side panel with the Client app thread of the Task or Project under the
 * cursor (fed by registerComments). Its images open full size on a click.
 * Images pasted in a draft (Ctrl+V) are uploaded to the app and linked. Reads,
 * replies, edits and deletes own comments through the Remote; never writes to
 * the vault.
 */
export class CommentPanelView extends ItemView {
	private headerEl!: HTMLElement;
	private listEl!: HTMLElement;
	private errorEl!: HTMLElement;
	private replyEl!: HTMLElement;
	private replyInput!: HTMLTextAreaElement;
	private unsubscribe: (() => void) | null = null;
	/** Owner of the rendered Markdown of the current list, unloaded on the next render and on close. */
	private renderScope: Component | null = null;
	/** Id of the item the reply draft was typed for. */
	private draftFor: string | null = null;
	/** Uploaded images shown in the thread, fetched with the token while the panel is open. */
	private readonly images: AppImages;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly session: ThreadSession,
		private readonly subscribe: (listener: (state: ThreadState) => void) => () => void,
		private readonly appUrl: () => string,
		/** The app's files: images of the thread read, pasted ones uploaded. */
		private readonly remote: Pick<Remote, "image" | "upload">,
	) {
		super(leaf);
		this.images = new AppImages((path) => remote.image(path));
	}

	getViewType(): string {
		return COMMENT_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Suivi comments";
	}

	getIcon(): string {
		return "messages-square";
	}

	async onOpen() {
		const root = this.contentEl;
		root.empty();
		root.addClass("suivi-comments");
		this.headerEl = root.createDiv({ cls: "suivi-comments-header" });
		this.errorEl = root.createDiv({ cls: "suivi-comments-error mod-warning" });
		this.listEl = root.createDiv({ cls: "suivi-comments-list" });
		// A comment's image full size on a click, as the Deck's thumbnails.
		this.registerDomEvent(this.listEl, "click", (e) => {
			if (!(e.target instanceof HTMLImageElement) || !e.target.closest(".suivi-comment-body")) return;
			e.preventDefault();
			new ImageModal(this.app, e.target.src, e.target.alt, () => {}).open();
		});
		this.replyEl = root.createDiv({ cls: "suivi-comments-reply" });
		this.replyInput = this.replyEl.createEl("textarea", { attr: { rows: "4", placeholder: "Reply (markdown, paste images)" } });
		this.replyInput.style.width = "100%";
		const uploads = this.withImagePaste(this.replyInput, this);
		const send = this.replyEl.createEl("button", { text: "Send", cls: "mod-cta" });
		const submit = async () => {
			send.disabled = true;
			if ((await uploads.settled()) && (await this.session.reply(this.replyInput.value))) this.replyInput.value = "";
			send.disabled = false;
		};
		send.onclick = () => void submit();
		this.replyInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void submit();
			}
		});
		this.unsubscribe = this.subscribe((state) => this.render(state));
		this.render(this.session.current);
	}

	async onClose() {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.releaseRenderScope();
		this.images.clear();
	}

	/**
	 * Pasted images uploaded into `textarea`'s draft, filed under the shown
	 * item; a failed upload is a Notice (the panel keeps the draft). The
	 * listener lives as long as `owner`.
	 */
	private withImagePaste(textarea: HTMLTextAreaElement, owner: Component) {
		const uploads = imagePasteHandler({
			upload: (data, name) => this.remote.upload(data, name, this.session.current.target?.id),
			report: (message) => new Notice(`Suivi: ${message}`),
		});
		owner.registerDomEvent(textarea, "paste", (e) => uploads.onPaste(textarea, e));
		return uploads;
	}

	private releaseRenderScope() {
		if (this.renderScope) this.removeChild(this.renderScope);
		this.renderScope = null;
	}

	private render(state: ThreadState) {
		const target = state.target;
		if (target?.id !== this.draftFor) {
			this.replyInput.value = "";
			this.draftFor = target?.id ?? null;
		}

		this.headerEl.empty();
		if (!target) {
			this.headerEl.createEl("p", {
				text: "Put the cursor on a pushed Task or in a pushed Project note to see its comments.",
				cls: "suivi-comments-empty",
			});
		} else {
			const title = this.headerEl.createEl("h4", { text: `${KIND_LABELS[target.kind]}: ${target.title}` });
			const reload = title.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Reload" } });
			setIcon(reload, "refresh-cw");
			reload.onclick = () => void this.session.reload();
		}
		this.replyEl.toggle(!!target && state.status === "ready");
		this.errorEl.setText(state.error ?? "");
		this.errorEl.toggle(!!state.error);

		this.listEl.empty();
		this.releaseRenderScope();
		this.renderScope = this.addChild(new Component());
		if (state.status === "loading") this.listEl.createEl("p", { text: "Loading…" });
		if (state.status === "ready" && state.comments.length === 0) this.listEl.createEl("p", { text: "No comments yet." });
		for (const comment of state.comments) this.renderComment(comment);
	}

	private renderComment(c: Comment) {
		const el = this.listEl.createDiv({ cls: "suivi-comment" });
		el.style.borderTop = "1px solid var(--background-modifier-border)";
		el.style.padding = "6px 0";
		const meta = el.createDiv({ cls: "suivi-comment-meta" });
		meta.createEl("strong", { text: c.mine ? "You" : c.author_email });
		meta.createSpan({ text: ` · ${DATE.format(new Date(c.created_at))}${c.edited_at ? " · modifié" : ""}` });
		const body = el.createDiv({ cls: "suivi-comment-body" });
		const scope = this.renderScope ?? this;
		const show = (images?: Map<string, string>) => {
			body.empty();
			void MarkdownRenderer.render(this.app, withAppUrls(highlightMentions(c.body, c.mentions), this.appUrl(), images), body, "", scope);
		};
		show();
		const paths = uploadedImages(c.body);
		if (paths.length > 0) {
			void this.images.urls(paths).then((images) => {
				// Not if the comment was re-rendered or is being edited meanwhile.
				if (images.size > 0 && body.isConnected && !body.querySelector("textarea")) show(images);
			});
		}
		if (!c.mine) return;

		const actions = el.createDiv({ cls: "suivi-comment-actions" });
		const edit = actions.createEl("button", { text: "Edit" });
		const del = actions.createEl("button", { text: "Delete" });
		edit.onclick = () => {
			body.empty();
			actions.empty();
			const input = body.createEl("textarea", { attr: { rows: "4" } });
			input.style.width = "100%";
			input.value = c.body;
			input.focus();
			const uploads = this.withImagePaste(input, scope);
			const save = async () => {
				if (await uploads.settled()) await this.session.edit(c.id, input.value);
			};
			actions.createEl("button", { text: "Save", cls: "mod-cta" }).onclick = () => void save();
			actions.createEl("button", { text: "Cancel" }).onclick = () => this.render(this.session.current);
		};
		del.onclick = () => {
			if (del.dataset.armed) {
				void this.session.remove(c.id);
				return;
			}
			del.dataset.armed = "1";
			del.setText("Confirm delete");
			del.addClass("mod-warning");
		};
	}
}
