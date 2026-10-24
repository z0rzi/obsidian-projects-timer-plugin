import { type App, Modal, Setting, type ToggleComponent } from "obsidian";
import { unplacedDetail, type UnplacedItem } from "../sync/unplaced";

/**
 * « n éléments hors du vault »: one switch « Retirer » per Unplaced item, and
 * one on top that sets them all. Confirming hands over the switched-on Items
 * to remove from the app; the others stay in the Inbox, one entry each.
 */
export class UnplacedModal extends Modal {
	private readonly removed = new Set<string>();

	constructor(
		app: App,
		private readonly items: UnplacedItem[],
		private readonly onConfirm: (removed: UnplacedItem[]) => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText(`${this.items.length} éléments hors du vault`);
		contentEl.createEl("p", {
			text: "Retirer archive l'élément dans l'app : le Client ne le voit plus. Les autres restent dans l'Inbox, à insérer.",
		});
		const toggles: ToggleComponent[] = [];
		new Setting(contentEl).setName("Tout retirer").addToggle((all) =>
			all.onChange((on) => {
				for (const toggle of toggles) toggle.setValue(on);
			}),
		);
		for (const item of this.items) {
			new Setting(contentEl)
				.setName(item.fields.title)
				.setDesc(unplacedDetail(item))
				.addToggle((toggle) => {
					toggles.push(toggle);
					toggle.setTooltip("Retirer").onChange((on) => {
						if (on) this.removed.add(item.id);
						else this.removed.delete(item.id);
					});
				});
		}
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Confirmer")
				.setCta()
				.onClick(() => {
					this.close();
					this.onConfirm(this.items.filter((i) => this.removed.has(i.id)));
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
