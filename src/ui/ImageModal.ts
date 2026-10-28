import { type App, Modal } from "obsidian";

/** An image of a Ticket full size, from its thumbnail on the Deck; Escape (or a click outside) closes it, then `done`. */
export class ImageModal extends Modal {
	constructor(
		app: App,
		private readonly src: string,
		private readonly alt: string,
		private readonly done: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("suivi-deck-image-modal");
		this.contentEl.createEl("img", { attr: { src: this.src, alt: this.alt } });
	}

	onClose() {
		this.contentEl.empty();
		this.done();
	}
}
