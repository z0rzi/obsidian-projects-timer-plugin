import { App, Modal, Setting } from "obsidian";

export interface ExportOptions {
	missionReference: string;
	totalTimeMins: number | null;
}

export class ExportActivitiesModal extends Modal {
	missionReference = "";
	totalTime = "";
	onSubmit: (options: ExportOptions) => void;

	constructor(
		app: App,
		onSubmit: (options: ExportOptions) => void,
		private parseTime: (raw: string) => number,
	) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl("h3", { text: "Export selected activities" });

		new Setting(contentEl)
			.setName("Mission reference")
			.setDesc("Optional. Will appear at the top of the CSV.")
			.addText((text) => {
				text.setPlaceholder("e.g. MISSION-2024-001");
				text.onChange((value) => {
					this.missionReference = value;
				});

				text.inputEl.onkeydown = (evt) => {
					if (evt.key === "Enter") {
						evt.stopPropagation();
						evt.preventDefault();
						this.submit();
					}
				};
			});

		new Setting(contentEl)
			.setName("Total time")
			.setDesc(
				"Optional. If provided, activities will be proportionally redistributed to match this total (rounded to 10min). Format: 1h30, 30m, 2h",
			)
			.addText((text) => {
				text.setPlaceholder("1h30, 30m, 2h");
				text.onChange((value) => {
					this.totalTime = value;
				});

				text.inputEl.onkeydown = (evt) => {
					if (evt.key === "Enter") {
						evt.stopPropagation();
						evt.preventDefault();
						this.submit();
					}
				};
			});

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText("Export").setCta().onClick(() => {
				this.submit();
			});
		});
	}

	private submit() {
		const totalTimeMins = this.totalTime.trim()
			? this.parseTime(this.totalTime.trim())
			: null;

		if (this.totalTime.trim() && (!totalTimeMins || totalTimeMins <= 0)) {
			return;
		}

		this.close();
		this.onSubmit({
			missionReference: this.missionReference.trim(),
			totalTimeMins,
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
