import {
	AbstractInputSuggest,
	App,
	PluginSettingTab,
	SearchComponent,
	Setting,
	TFile,
	TFolder,
	Notice,
} from "obsidian";
import ProjectsTimerPlugin from "./main";
import { connectionStatus } from "./remote/connectionStatus";
import { settingsRemote } from "./remote/settingsRemote";
import { countAppIds, disconnect, disconnectMessage } from "./sync/disconnect";
import { vaultFiles } from "./sync/vaultFiles";
import { DisconnectModal } from "./ui/DisconnectModal";

export interface ProjectsTimerSettings {
	projectsLocation: string;
	timeSourceLocation: string;
	projectTemplate: string;
	tasksKanbanFile: string;
	/** Template of today's Daily note when Triage has to create it; "" = none (an empty note). The note's path comes from the core Daily notes settings. */
	triageTemplate: string;
	/** Heading of the Daily note section Triage appends its lines to. */
	triageHeading: string;
	/** The Sweep's age in days: the first Deck session of the day offers the Tag tasks of Daily notes older than that, and keeps one that long. */
	sweepAge: number;
	hoursPerDay: number;
	daysPerWeek: number;
	hourlyRate: number;
	/** Client app URL, e.g. https://suivi.mbz-dev.com */
	suiviUrl: string;
	/** Personal API token from the Client app's Paramètres page. */
	suiviToken: string;
}

export const DEFAULT_SETTINGS: ProjectsTimerSettings = {
	projectsLocation: "",
	timeSourceLocation: "",
	projectTemplate: "",
	tasksKanbanFile: "",
	triageTemplate: "",
	triageHeading: "## Triage",
	sweepAge: 7,
	hoursPerDay: 8,
	daysPerWeek: 5,
	hourlyRate: 0,
	suiviUrl: "",
	suiviToken: "",
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
			"The directory which contains the project files: a note directly in it is a Project note, and a link to it on a Task line, or alone on the first line of the Task's body, attaches the Task to that Project",
			"Projects/",
			this.plugin.settings.projectsLocation,
			async (value) => {
				this.plugin.settings.projectsLocation = value;
				await this.plugin.saveSettings();
			},
			true,
		);

		this.addPathSetting(
			"Time Source location",
			"The directory which contains the time source files",
			"TimeSources/",
			this.plugin.settings.timeSourceLocation,
			async (value) => {
				this.plugin.settings.timeSourceLocation = value;
				await this.plugin.saveSettings();
			},
			true,
		);

		this.addPathSetting(
			"Project template",
			"The file to be used as the template for new projects (« Lancer en projet » on an #idea line)",
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

		this.addPathSetting(
			"Triage daily note template",
			"The file today's daily note is created from when Triage writes into it and it doesn't exist yet; empty for an empty note. The note's folder and name come from the core Daily notes settings",
			"Templates/Daily.md",
			this.plugin.settings.triageTemplate,
			async (value) => {
				this.plugin.settings.triageTemplate = value;
				await this.plugin.saveSettings();
			},
			false,
		);

		new Setting(this.containerEl)
			.setName("Triage heading")
			.setDesc("The heading of today's daily note under which Triage writes its Tasks, added at the end of the note when missing")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.triageHeading)
					.setValue(this.plugin.settings.triageHeading)
					.onChange(async (value) => {
						this.plugin.settings.triageHeading = value.trim() || DEFAULT_SETTINGS.triageHeading;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(this.containerEl)
			.setName("Sweep age (days)")
			.setDesc(
				"The first Deck session of the day starts with the Tag tasks of daily notes older than this, open, not at pz, p0 or p1 and not kept; Enter keeps one this many days",
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.sweepAge))
					.setValue(String(this.plugin.settings.sweepAge))
					.onChange(async (value) => {
						const days = parseInt(value);
						this.plugin.settings.sweepAge = days > 0 ? days : DEFAULT_SETTINGS.sweepAge;
						await this.plugin.saveSettings();
					}),
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

		new Setting(this.containerEl).setName("Client app (Suivi)").setHeading();

		new Setting(this.containerEl)
			.setName("Suivi URL")
			.setDesc("Address of the Client app. Push (on demand, and after a Deck session for what the Sweep wrote) sends Project and Task titles, descriptions, types, priorities and Done there; Pull and the Inbox fetch the Client's changes and Notifications on startup and every 5 minutes, and the Inbox's « Hors du vault » inserts or archives an Item; the comments panel reads and sends comments while open; the Deck reads the state and the items to triage, then triages (downloading its images) or archives each Ticket; the Sweep keeps a Task; « Lancer en projet » sends the new project note. See the README's Network use section.")
			.addText((text) =>
				text
					.setPlaceholder("https://suivi.mbz-dev.com")
					.setValue(this.plugin.settings.suiviUrl)
					.onChange(async (value) => {
						this.plugin.settings.suiviUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(this.containerEl)
			.setName("Suivi API token")
			.setDesc("Created on the Paramètres page of the Client app (Developer account).")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(this.plugin.settings.suiviToken).onChange(async (value) => {
					this.plugin.settings.suiviToken = value.trim();
					await this.plugin.saveSettings();
				});
			});

		const connectionTest = new Setting(this.containerEl)
			.setName("Test connection")
			.setDesc("Checks the Suivi URL and API token above.");
		connectionTest.addButton((button) =>
			button.setButtonText("Test connection").onClick(async () => {
				button.setDisabled(true).setButtonText("Testing…");
				connectionTest.setDesc(await connectionStatus(settingsRemote(this.plugin.settings)));
				button.setDisabled(false).setButtonText("Test connection");
			}),
		);

		new Setting(this.containerEl)
			.setName("Se déconnecter de l'app Client")
			.setDesc("Removes the Client app IDs from the notes and clears the Suivi URL and token. Never calls the app.")
			.addButton((button) =>
				button
					.setButtonText("Se déconnecter de l'app Client")
					.setWarning()
					.onClick(() => this.confirmDisconnect()),
			);
	}

	/** Counts the app ids in the vault, then disconnects once the Developer confirms. */
	private async confirmDisconnect(): Promise<void> {
		const files = vaultFiles(this.app);
		const message = disconnectMessage(await countAppIds(files), this.plugin.settings);
		new DisconnectModal(this.app, message, async () => {
			try {
				await disconnect(files, this.plugin.data);
				new Notice("Disconnected from the Client app.");
			} catch (e) {
				new Notice(`Disconnect failed: ${(e as Error).message}`, 10_000);
			}
			this.display();
		}).open();
	}
}
