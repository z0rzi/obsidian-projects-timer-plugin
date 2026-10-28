import { type App, Modal, Setting } from "obsidian";

/**
 * « Abandonner n décisions ? » when the Deck closes before its decisions are
 * written: « Abandonner » drops them, nothing written; « Reprendre » (or
 * closing the modal) keeps the session.
 */
export class DiscardModal extends Modal {
	private chosen = false;

	constructor(
		app: App,
		private readonly count: number,
		private readonly onDiscard: () => void,
		private readonly onKeep: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.setTitle(`Abandonner ${this.count} décision${this.count > 1 ? "s" : ""} ?`);
		this.contentEl.createEl("p", { text: "Rien n'est encore écrit : abandonner ne touche ni l'app ni les notes." });
		const choose = (run: () => void) => () => {
			this.chosen = true;
			this.close();
			run();
		};
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Reprendre").setCta().onClick(choose(this.onKeep)))
			.addButton((b) => b.setButtonText("Abandonner").setWarning().onClick(choose(this.onDiscard)));
	}

	onClose() {
		this.contentEl.empty();
		if (!this.chosen) this.onKeep();
	}
}

/**
 * Before the Deck's decisions are dropped: `discard` at once when there are none (`count` 0), else on
 * « Abandonner »; `keep` on « Reprendre » or the modal closed.
 */
export function confirmDiscard(app: App, count: number, discard: () => void, keep: () => void) {
	if (count === 0) discard();
	else new DiscardModal(app, count, discard, keep).open();
}
