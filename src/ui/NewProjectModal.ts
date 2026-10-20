import { type App, Modal, Setting } from "obsidian";
import type { NewProjectChoice } from "../inbox/newProject";

const PRIORITIES = [0, 1, 2, 3, 4, 5];
const DEFAULT_PRIORITY = 3;

/** "Nouveau projet" dialog: pick the priority of the Project file created for a launched Idea. */
export class NewProjectModal extends Modal {
	private choice: NewProjectChoice = { priority: DEFAULT_PRIORITY };

	constructor(
		app: App,
		private readonly item: { title: string },
		private readonly onSubmit: (choice: NewProjectChoice) => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText(`Nouveau projet : ${this.item.title}`);
		new Setting(contentEl).setName("Priority").addDropdown((d) => {
			for (const p of PRIORITIES) d.addOption(String(p), p === 0 ? "p0 (doing now)" : `p${p}`);
			d.setValue(String(this.choice.priority)).onChange((v) => (this.choice.priority = Number(v)));
		});
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Nouveau projet")
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
