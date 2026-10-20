import { type App, Modal, Setting } from "obsidian";
import { defaultTag, TRIAGE_TAGS, type TriageChoice } from "../inbox/triage";

const PRIORITIES = [0, 1, 2, 3, 4, 5];
const DEFAULT_PRIORITY = 3;

/** "Insérer ici" dialog: pick the tag and priority of the Task line written at the cursor. */
export class TriageModal extends Modal {
	private choice: TriageChoice;

	constructor(
		app: App,
		private readonly item: { title: string; type: string },
		private readonly onSubmit: (choice: TriageChoice) => void,
	) {
		super(app);
		this.choice = { type: defaultTag(item.type), priority: DEFAULT_PRIORITY };
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText(`Insérer ici : ${this.item.title}`);
		new Setting(contentEl).setName("Type").addDropdown((d) => {
			for (const t of TRIAGE_TAGS) d.addOption(t.type, t.label);
			d.setValue(this.choice.type).onChange((v) => (this.choice.type = v as TriageChoice["type"]));
		});
		new Setting(contentEl).setName("Priority").addDropdown((d) => {
			for (const p of PRIORITIES) d.addOption(String(p), p === 0 ? "p0 (doing now)" : `p${p}`);
			d.setValue(String(this.choice.priority)).onChange((v) => (this.choice.priority = Number(v)));
		});
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Insérer ici")
				.setCta()
				.onClick(() => this.submit()),
		);
		this.scope.register([], "Enter", (e) => {
			e.preventDefault();
			this.submit();
		});
	}

	private submit() {
		this.close();
		this.onSubmit(this.choice);
	}

	onClose() {
		this.contentEl.empty();
	}
}
