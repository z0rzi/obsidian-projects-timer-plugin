import {
	AbstractInputSuggest,
	App,
	PluginSettingTab,
	SearchComponent,
	Setting,
	TFile,
	TFolder,
} from "obsidian";
import ProjectsTimerPlugin from "./main";

export interface ProjectsTimerSettings {
	projectsLocation: string;
	projectTemplate: string;
	tasksKanbanFile: string;
	hoursPerDay: number;
	daysPerWeek: number;
	hourlyRate: number;
}

export const DEFAULT_SETTINGS: ProjectsTimerSettings = {
	projectsLocation: "",
	projectTemplate: "",
	tasksKanbanFile: "",
	hoursPerDay: 8,
	daysPerWeek: 5,
	hourlyRate: 0,
};

class FolderSuggest extends AbstractInputSuggest<string> {
	private folders: string[];

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.folders = app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder)
			.map((f) => f.path);
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase();
		return this.folders.filter((p) => p.toLowerCase().includes(q));
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}
}

export class FileSuggest extends AbstractInputSuggest<string> {
	private files: string[];

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.files = app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFile => f instanceof TFile)
			.map((f) => f.path);
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase();
		return this.files.filter((p) => p.toLowerCase().includes(q));
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}
}

export class ProjectsTimerSettingTab extends PluginSettingTab {
	plugin: ProjectsTimerPlugin;

	constructor(app: App, plugin: ProjectsTimerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private addPathSetting(
		name: string,
		desc: string,
		placeholder: string,
		value: string,
		onSelect: (value: string) => Promise<void>,
		isFolder: boolean,
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addSearch((search: SearchComponent) => {
				search.setPlaceholder(placeholder);
				search.setValue(value);

				const suggest = isFolder
					? new FolderSuggest(this.app, search.inputEl)
					: new FileSuggest(this.app, search.inputEl);

				suggest.onSelect(async (selected: string) => {
					search.setValue(selected);
					suggest.close();
					await onSelect(selected);
				});
			});
	}

	display(): void {
		this.containerEl.empty();

		this.addPathSetting(
			"Projects location",
			"The directory which contains the project files",
			"Projects/",
			this.plugin.settings.projectsLocation,
			async (value) => {
				this.plugin.settings.projectsLocation = value;
				await this.plugin.saveSettings();
			},
			true,
		);

		this.addPathSetting(
			"Project template",
			"The file to be used as the template for new projects",
			"Templates/Project.md",
			this.plugin.settings.projectTemplate,
			async (value) => {
				this.plugin.settings.projectTemplate = value;
				await this.plugin.saveSettings();
			},
			false,
		);

		this.addPathSetting(
			"Tasks kanban file",
			"The file to be used as the kanban board for the tasks",
			"Kanban/Tasks.md",
			this.plugin.settings.tasksKanbanFile,
			async (value) => {
				this.plugin.settings.tasksKanbanFile = value;
				await this.plugin.saveSettings();
			},
			false,
		);

		new Setting(this.containerEl)
			.setName("Hours per day")
			.setDesc("The amount of hours you should work per day")
			.addText((text) =>
				text
					.setPlaceholder("8")
					.setValue(String(this.plugin.settings.hoursPerDay))
					.onChange(async (value) => {
						this.plugin.settings.hoursPerDay = parseInt(value) || 0;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(this.containerEl)
			.setName("Days per week")
			.setDesc("The amount of days you should work per week")
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(String(this.plugin.settings.daysPerWeek))
					.onChange(async (value) => {
						this.plugin.settings.daysPerWeek = parseInt(value) || 0;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(this.containerEl)
			.setName("Hourly rate")
			.setDesc("How much money you make per hour")
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(this.plugin.settings.hourlyRate))
					.onChange(async (value) => {
						this.plugin.settings.hourlyRate =
							parseFloat(value) || 0;
						await this.plugin.saveSettings();
					}),
			);
	}
}
