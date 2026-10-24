import { App, Modal, Setting } from "obsidian";

/** Asks to confirm the Disconnect from the Client app; `onDisconnect` runs on confirm. */
export class DisconnectModal extends Modal {
	constructor(
		app: App,
		private readonly message: string,
		private readonly onDisconnect: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.setTitle("Disconnect this vault from the Client app");
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Disconnect")
					.setWarning()
					.onClick(() => {
						this.close();
						this.onDisconnect();
					}),
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
