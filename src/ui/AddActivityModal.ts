import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { FileSuggest } from "settings";

export class AddActivityModal extends Modal {
	duration = "";
	description = "";
	onSubmit: (duration: number, description: string, projectFile: TFile) => void;

	constructor(
		app: App,
		onSubmit: typeof AddActivityModal.prototype.onSubmit,
		private parseTime: (raw: string) => number,
		private minutesWorked?: number,
		private projectFile?: TFile,
	) {
		super(app);
		this.onSubmit = onSubmit;
	}

	private submit() {
		const mins =
			this.minutesWorked != null
				? this.minutesWorked
				: this.parseTime(this.duration);
		if (!mins) {
			new Notice(
				"Invalid duration format...\n\nValid format: 1h30, 1h, 30m",
			);
			return;
		}
		if (!this.description) {
			new Notice("Description cannot be empty...");
			return;
		}
		if (!this.projectFile) {
			new Notice("Project file cannot be empty...");
			return;
		}
		this.close();
		this.onSubmit(mins, this.description, this.projectFile);
	}

	private async validateProjectFile(file: TFile) {
		// We make sure there's a project code block in the file
		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");
		for (const line of lines) {
			if (line === "```project") {
				return true;
			}
		}
		return false;
	}

	onOpen() {
		const { contentEl } = this;

		new Setting(contentEl).setName("Project").addText((text) => {
			if (this.projectFile) {
				text.setValue(this.projectFile.basename);
				text.setDisabled(true);
			} else {
				const suggest = new FileSuggest(this.app, text.inputEl);
				suggest.onSelect(async (selected: string) => {
					text.setValue(selected);
					suggest.close();
					const file = this.app.vault.getAbstractFileByPath(
						selected,
					) as TFile;
					this.validateProjectFile(file).then((valid) => {
						if (!valid) {
							text.setValue('');
							new Notice("Not a project file...");
							return;
						}
						this.projectFile = file as TFile;
					});
				});

				text.setPlaceholder("Project file");
				text.inputEl.onblur = () => {
					if (!this.projectFile) {
						text.setValue('');
						return;
					}
					text.setValue(this.projectFile.basename);
				};
			}
		});

		new Setting(contentEl).setName("Time worked").addText((text) => {
			if (this.minutesWorked != null) {
				const h = Math.floor(this.minutesWorked / 60);
				const m = this.minutesWorked % 60;
				this.duration = h && m ? `${h}h${m}m` : h ? `${h}h` : `${m}m`;
				text.setValue(this.duration);
				text.setDisabled(true);
			} else {
				text.setPlaceholder("1h30, 1h, 30m");
				text.onChange((value) => {
					this.duration = value;
				});

				text.inputEl.onkeydown = (evt) => {
					if (evt.key === "Enter") {
						evt.stopPropagation();
						evt.preventDefault();
						this.submit();
					}
				};
			}
		});

		new Setting(contentEl).setName("What did you do?").addText((text) => {
			text.onChange((value) => {
				this.description = value;
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
			btn.setButtonText("OK").onClick(() => {
				this.submit();
			});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
