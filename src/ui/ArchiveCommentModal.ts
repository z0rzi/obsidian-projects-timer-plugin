import { type App, Modal } from "obsidian";

/**
 * « Archiver » in the Deck: one line of comment for the Client, optional,
 * the one recorded before when the card is decided again. Enter records the
 * archive with it (empty: none); Escape gives the archive up.
 */
export class ArchiveCommentModal extends Modal {
	private done = false;

	constructor(
		app: App,
		private readonly title: string,
		private readonly onSubmit: (comment: string | null) => void,
		private readonly onCancel: () => void,
		private readonly comment: string | null = null,
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(`Archiver : ${this.title}`);
		const input = this.contentEl.createEl("input", { type: "text", cls: "suivi-deck-archive-comment", attr: { placeholder: "Commentaire (facultatif), Entrée pour archiver" } });
		input.value = this.comment ?? "";
		input.focus();
		this.scope.register([], "Enter", (e) => {
			e.preventDefault();
			this.done = true;
			const comment = input.value.trim();
			this.close();
			this.onSubmit(comment || null);
		});
	}

	onClose() {
		this.contentEl.empty();
		if (!this.done) this.onCancel();
	}
}
