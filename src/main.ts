import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	parseLinktext,
	Plugin,
	setIcon,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import path from "path";
import { BehaviorSubject } from "rxjs";
import {
	DEFAULT_SETTINGS,
	ProjectsTimerSettings,
	ProjectsTimerSettingTab,
} from "./settings";
import { Activity, ProjectCard, Task, TimeSource } from "./types";
import { parseTasks } from "./taskParser";
import { localDay } from "./localDate";
import { parseProjectCard } from "./projectCards";
import { AddActivityModal } from "./ui/AddActivityModal";
import { PluginData } from "./sync/pluginData";
import { registerComments } from "./comments/registerComments";
import { registerPush } from "./sync/registerPush";
import { registerPull } from "./sync/registerPull";
import { registerInbox } from "./inbox/registerInbox";
import {
	TASKS_KANBAN_VIEW_TYPE,
	TasksKanbanView,
} from "./views/TasksKanbanView";
import {
	PROJECTS_LIST_VIEW_TYPE,
	ProjectsListView,
} from "./views/ProjectsListView";
import { ACTIVITIES_VIEW_TYPE, ActivitiesView } from "./views/ActivitiesView";

function makeTaskHash(task: Task) {
	return [
		task.type,
		task.priority,
		task.title,
		task.description,
		task.file.path,
		task.line,
		task.raw,
	].join("@");
}

export default class ProjectsTimerPlugin extends Plugin {
	settings: ProjectsTimerSettings;
	data: PluginData<ProjectsTimerSettings>;
	/** Suivi Inbox store (unread comments feed the kanban dots); set in onload. */
	inbox: ReturnType<typeof registerInbox> | null = null;

	revenueSpan: HTMLElement;
	todayWorkedSpan: HTMLElement;
	weekWorkedSpan: HTMLElement;

	/**
	 * Function used to parse human written time to minutes
	 * Supported formats:
	 * - 1.5d
	 * - 1h30
	 * - 1h30m
	 * - 30m
	 */
	parseTime(time: string): number {
		let hours = 0;
		let mins = 0;

		const hoursPerDay = this.settings.hoursPerDay;

		time.replace(/[0-9\.]+d/, (rawdays) => {
			hours = +rawdays.slice(0, -1) * hoursPerDay;
			return "d";
		})
			.replace(/[0-9\.]+h/, (rawhours) => {
				hours = +rawhours.slice(0, -1);
				return "h";
			})
			.replace(/h[0-9\.]+/, (rawmins) => {
				mins = +rawmins.slice(1);
				return "";
			})
			.replace(/[0-9\.]+m/, (rawmins) => {
				mins = +rawmins.slice(0, -1);
				return "";
			});

		return hours * 60 + mins;
	}

	formatMoney(amount: number, currency = "EUR", digits = 2) {
		let localeCode = "fr-FR";
		if (currency === "USD") localeCode = "en-US";
		if (currency === "GBP") localeCode = "en-GB";
		if (currency === "CAD") localeCode = "en-CA";
		if (currency === "AUD") localeCode = "en-AU";
		if (currency === "JPY") localeCode = "ja-JP";

		return amount.toLocaleString(localeCode, {
			style: "currency",
			currency,
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
		});
	}

	formatDuration(mins: number, showDays = true): string {
		const hoursPerDay = this.settings.hoursPerDay;

		let days = Math.floor(mins / 60 / hoursPerDay);
		if (!showDays) days = 0;
		if (days >= 2) {
			mins -= days * 60 * hoursPerDay;
		} else {
			days = 0;
		}
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		let out = "";
		if (days > 0) out += `${days}d `;
		if (h && m) return out + `${h}h${m}`;
		if (h) return out + `${h}h`;
		if (m) return out + `${m}m`;
		if (out.length) return out.trim();

		return "0m";
	}

	formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = date.getMonth() + 1;
		const day = date.getDate();

		return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	}

	findFileFromLink(link: string, sourcePath = ""): TFile | null {
		if (link.startsWith("[[") && link.endsWith("]]"))
			link = link.slice(2, -2);

		// Drop the "|alias" and "#heading" parts of the wikilink
		link = parseLinktext(link.split("|")[0]!.trim()).path;

		const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
			link,
			sourcePath,
		);
		if (linkedFile) return linkedFile;

		let resolvedFile = this.app.vault.getFileByPath(link);
		if (resolvedFile) return resolvedFile;

		if (!resolvedFile) {
			// Trying to find it just by filename
			const fileName = path.basename(link, ".md");
			if (fileName) {
				const allFiles = this.app.vault.getAllLoadedFiles();
				for (const file of allFiles) {
					if (!(file instanceof TFile)) continue;
					if (path.basename(file.path, ".md") === fileName) {
						return file;
					}
				}
			}
		}

		return null;
	}

	timeSourcesCache: Map<string, TimeSource[]> = new Map();
	isBuildingCache = false;

	async buildTimeSourceCache() {
		if (this.isBuildingCache) return;
		this.isBuildingCache = true;
		try {
			this.timeSourcesCache.clear();
			const tsFolder = this.settings.timeSourceLocation;
			if (!tsFolder) return;

			const files = this.app.vault
				.getAllLoadedFiles()
				.filter(
					(f): f is TFile =>
						f instanceof TFile &&
						f.path.startsWith(tsFolder) &&
						f.path.endsWith(".md"),
				);

			for (const file of files) {
				const cache = this.app.metadataCache.getFileCache(file);
				const status = cache?.frontmatter?.status;
				const completed = cache?.frontmatter?.tasks_completed ?? false;

				const content = await this.app.vault.cachedRead(file);
				const lines = content.split("\n");

				let inTsBlock = false;
				for (const line of lines) {
					if (line.startsWith("```timesource")) {
						inTsBlock = true;
						continue;
					}
					if (inTsBlock && line.startsWith("```")) {
						inTsBlock = false;
						continue;
					}
					if (inTsBlock) {
						const parts = line.split(";").map((p) => p.trim());
						if (parts.length >= 2) {
							const raw = parts[0] ?? "";
							const linkMatch = raw.match(/\[\[(.+?)\]\]/);
							let label = raw;
							let resolvedFile = null;
							if (linkMatch) {
								label = linkMatch[1]!;
								resolvedFile = this.findFileFromLink(
									label,
									file.path,
								);
							}

							const duration = this.parseTime(parts[1] ?? "");
							const targetPath = resolvedFile
								? resolvedFile.path
								: label;

							if (!this.timeSourcesCache.has(targetPath)) {
								this.timeSourcesCache.set(targetPath, []);
							}

							this.timeSourcesCache.get(targetPath)!.push({
								label,
								resolvedFile,
								duration,
								sourceFile: file,
								status: status || "",
								completed,
							});
						}
					}
				}
			}
		} finally {
			this.isBuildingCache = false;
		}
	}

	async onload() {
		await this.loadSettings();

		this.app.workspace.onLayoutReady(async () => {
			await this.buildTimeSourceCache();
		});

		this.registerEvent(
			this.app.metadataCache.on("changed", () =>
				this.buildTimeSourceCache(),
			),
		);
		this.registerEvent(
			this.app.vault.on("create", () => this.buildTimeSourceCache()),
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.buildTimeSourceCache()),
		);
		this.registerEvent(
			this.app.vault.on("rename", () => this.buildTimeSourceCache()),
		);

		this.registerView(
			TASKS_KANBAN_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new TasksKanbanView(leaf, this),
		);

		this.registerView(
			PROJECTS_LIST_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new ProjectsListView(leaf, this),
		);

		this.registerView(
			ACTIVITIES_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new ActivitiesView(leaf, this),
		);

		// This creates an icon in the left ribbon.
		this.addRibbonIcon("square-kanban", "Open Tasks Kanban", () => {
			this.openKanbanView();
		});
		this.addRibbonIcon("file-check", "Open Projects List", () => {
			this.openProjectsListView();
		});
		this.addRibbonIcon("ticket-check", "Open Activities List", () => {
			this.openActivitiesView();
		});

		this.registerMarkdownCodeBlockProcessor(
			"project",
			async (source: string, container: HTMLElement, ctx) => {
				const filepath = ctx.sourcePath;
				const file = this.app.vault.getFileByPath(filepath);
				if (!file) {
					new Notice("No file found");
					return;
				}

				// Header bar with "Add an activity" button
				const header = container.createEl("div");
				header.style.display = "flex";
				header.style.justifyContent = "flex-end";
				header.style.marginBottom = "10px";

				const addBtn = header.createEl("button", {
					text: "Add an activity",
				});
				addBtn.onclick = () => {
					new AddActivityModal(
						this.app,
						(duration, description, projectFile) => {
							this.addActivityToFile(
								projectFile,
								duration,
								description,
							);
						},
						(raw) => this.parseTime(raw),
						undefined,
						file,
					).open();
				};

				const timeSources = this.timeSourcesCache.get(file.path) || [];
				const activities = await this.parseActivities({
					blockContent: source,
				});

				const totalAvailable = timeSources.reduce((s, t) => {
					if (t.status === "accepted" || t.status === "paid") {
						return s + t.duration;
					}
					return s;
				}, 0);
				const totalWorked = activities.reduce(
					(s, a) => s + a.duration,
					0,
				);

				// Progress bar
				const progressLabel = container.createEl("div", {
					text: `${this.formatDuration(totalWorked)} / ${this.formatDuration(totalAvailable)}`,
				});
				progressLabel.style.textAlign = "center";
				progressLabel.style.marginBottom = "4px";

				const progressOuter = container.createEl("div");
				progressOuter.style.width = "100%";
				progressOuter.style.height = "10px";
				progressOuter.style.backgroundColor = "#0004";
				progressOuter.style.borderRadius = "3px";

				const progressInner = progressOuter.createEl("div");
				const pct =
					totalAvailable > 0
						? (totalWorked / totalAvailable) * 100
						: 0;
				progressInner.style.width = `${Math.min(pct, 100)}%`;
				progressInner.style.height = "100%";
				progressInner.style.backgroundColor =
					pct > 100 ? "#d04040" : "#406d40";
				progressInner.style.borderRadius = "3px";

				// Time sources list
				if (timeSources.length > 0) {
					const sourcesHeading = container.createEl("b", {
						text: "Sources",
					});
					sourcesHeading.style.display = "block";
					sourcesHeading.style.marginTop = "16px";
					sourcesHeading.style.marginBottom = "6px";

					const sourcesList = container.createEl("ul");
					sourcesList.style.listStyle = "none";
					sourcesList.style.padding = "0";
					sourcesList.style.margin = "0";

					for (const src of timeSources) {
						if (src.status === "refused") continue;

						const li = sourcesList.createEl("li");
						li.style.marginBottom = "2px";

						let style = {
							additionalText: "",
							css: {} as Record<string, string>,
						};

						if (src.status === "paid") {
							style.additionalText = "(paid)";
						} else if (src.status === "pending") {
							// Not counting this time source
							style = {
								additionalText: "(not accepted)",
								css: {
									color: "var(--text-faint)",
									fontStyle: "italic",
								},
							};
						}

						if (src.completed) {
							style.additionalText += " (completed)";
							style.css.textDecoration = "line-through";
							style.css.color = "var(--text-faint)";
						}

						const linkText = src.sourceFile.basename;
						const link = li.createEl("a", { text: linkText });
						link.href = linkText;
						link.addEventListener("click", (e: MouseEvent) => {
							e.preventDefault();
							this.app.workspace.openLinkText(linkText, filepath);
						});

						link.addEventListener("mouseover", (event: MouseEvent) => {
							event.preventDefault();
							this.app.workspace.trigger("hover-link", {
								event,
								source: "preview",
								hoverParent: { hoverPopover: null },
								targetEl: link,
								linktext: linkText,
								sourcePath: filepath,
							});
						});

						if (style.css) {
							Object.assign(link.style, style.css);
						}

						if (style.additionalText) {
							const additionalTextSpan = li.createEl("span", {
								text: style.additionalText,
							});
							additionalTextSpan.style.marginLeft = "4px";
							additionalTextSpan.style.color =
								"var(--text-faint)";
							additionalTextSpan.style.fontSize = "0.8em";
						}

						const durationSpan = li.createEl("span", {
							text: ` ~ ${this.formatDuration(src.duration)}`,
						});
						durationSpan.style.color = "var(--text-faint)";
					}

					const divider = container.createEl("hr");
					divider.style.marginBottom = "15px";
					divider.style.marginTop = "15px";
				}

				// Activities table
				const activitiesHeading = container.createEl("b", {
					text: "Activities",
				});
				activitiesHeading.style.display = "block";
				activitiesHeading.style.marginBottom = "6px";

				const tableContainer = container.createEl("div");
				tableContainer.style.overflow = "auto";
				tableContainer.style.maxHeight = "500px";

				const table = tableContainer.createEl("table");
				table.style.width = "100%";
				const thead = table.createEl("thead");
				const tbody = table.createEl("tbody");

				const headTr = thead.createEl("tr");
				headTr.createEl("th", { text: "Date" });
				headTr.createEl("th", { text: "Time" });
				headTr.createEl("th", { text: "Description" });

				for (const act of activities) {
					const tr = tbody.createEl("tr");
					tr.createEl("td", { text: act.date });
					tr.createEl("td", {
						text: this.formatDuration(act.duration),
					});
					tr.createEl("td", { text: act.description });
				}

				window.setTimeout(() => this.updateStatusBar(), 100);
			},
		);

		this.registerMarkdownCodeBlockProcessor(
			"timesource",
			async (source: string, container: HTMLElement, ctx) => {
				const filepath = ctx.sourcePath;
				const file = this.app.vault.getFileByPath(filepath);
				if (!file) return;

				const cache = this.app.metadataCache.getFileCache(file);
				const status = cache?.frontmatter?.status;

				if (!status) {
					const errorEl = container.createEl("div");
					errorEl.style.color = "var(--text-error)";
					errorEl.style.fontWeight = "bold";
					errorEl.style.marginBottom = "8px";
					errorEl.style.padding = "8px";
					errorEl.style.border = "1px solid var(--text-error)";
					errorEl.style.borderRadius = "4px";
					errorEl.style.backgroundColor =
						"rgba(var(--color-red-rgb), 0.1)";
					errorEl.innerText =
						"Error: 'status' is missing from the file properties (frontmatter).";
				}

				const lines = source
					.split("\n")
					.map((l) => l.trim())
					.filter(Boolean);

				if (lines.length === 0) return;

				const title = container.createEl("b", {
					text: "Time distribution",
				});
				title.style.display = "block";
				title.style.marginBottom = "6px";

				const list = container.createEl("ul");
				// list.style.listStyle = "none";
				list.style.padding = "0";
				list.style.margin = "0";

				for (const line of lines) {
					const parts = line.split(";").map((p) => p.trim());
					if (parts.length < 2) continue;

					const raw = parts[0] ?? "";
					const durationStr = parts[1] ?? "";
					const duration = this.parseTime(durationStr);

					const linkMatch = raw.match(/\[\[(.+?)\]\]/);
					let label = raw;
					if (linkMatch) {
						label = linkMatch[1]!;
					}
					// "path|alias": link to the path, display the alias
					const [linktext = label, alias] = label
						.split("|")
						.map((p) => p.trim());
					const displayText = alias || linktext;

					const resolvedFile = this.findFileFromLink(label, filepath);

					const li = list.createEl("li");
					li.style.marginBottom = "4px";

					if (!resolvedFile) {
						const errorMsg = li.createEl("span", {
							text: `⚠️ Project not found: ${label}`,
						});
						errorMsg.style.color = "var(--text-error)";
						errorMsg.style.marginRight = "8px";
					} else {
						const content =
							await this.app.vault.cachedRead(resolvedFile);
						if (!content.includes("```project")) {
							const errorMsg = li.createEl("span", {
								text: `⚠️ No project block in ${displayText}`,
							});
							errorMsg.style.color = "var(--text-error)";
							errorMsg.style.marginRight = "8px";
						} else {
							const link = li.createEl("a", { text: displayText });
							link.href = linktext;
							link.addEventListener("click", (e: MouseEvent) => {
								e.preventDefault();
								this.app.workspace.openLinkText(
									linktext,
									filepath,
								);
							});

							link.addEventListener("mouseover", (event: MouseEvent) => {
								event.preventDefault();
								this.app.workspace.trigger("hover-link", {
									event,
									source: "preview",
									hoverParent: { hoverPopover: null },
									targetEl: link,
									linktext,
									sourcePath: filepath,
								});
							});
						}
					}

					li.createEl("span", {
						text: ` — ${this.formatDuration(duration)}`,
					});
				}
			},
		);

		const comments = registerComments(this, this.data);
		this.inbox = registerInbox(this, this.data, comments);
		registerPush(this, this.data, this.inbox.afterPush);
		registerPull(this, this.data, this.inbox.pullHooks);

		this.addCommand({
			id: "open-tasks-kanban",
			name: "Open Tasks Kanban",
			callback: () => this.openKanbanView(),
		});

		this.addCommand({
			id: "open-projects-list",
			name: "Open Projects List",
			callback: () => this.openProjectsListView(),
		});

		this.addCommand({
			id: "open-activities",
			name: "Open Activities",
			callback: () => this.openActivitiesView(),
		});

		// Status bar
		let separators: HTMLElement[] = [];

		const statusBarEl = this.addStatusBarItem();
		this.revenueSpan = statusBarEl.createEl("span");
		this.revenueSpan.setAttr("title", "Net income over the last 30 days");

		separators.push(statusBarEl.createEl("div"));

		const todayContainer = statusBarEl.createEl("span");
		todayContainer.setAttr("title", "Time worked today");
		this.todayWorkedSpan = todayContainer.createEl("span");
		this.todayWorkedSpan.style.fontWeight = "bold";
		const dailyExpectedWorkTime = this.settings.hoursPerDay * 60;
		todayContainer.appendText(
			` / ${this.formatDuration(dailyExpectedWorkTime, false)}`,
		);

		separators.push(statusBarEl.createEl("div"));

		const weekContainer = statusBarEl.createEl("span");
		weekContainer.setAttr("title", "Time worked this week");
		this.weekWorkedSpan = weekContainer.createEl("span");
		this.weekWorkedSpan.style.fontWeight = "bold";
		const weeklyExpectedWorkTime =
			this.settings.hoursPerDay * this.settings.daysPerWeek * 60;

		weekContainer.appendText(
			` / ${this.formatDuration(weeklyExpectedWorkTime, false)}`,
		);

		for (const sep of separators) {
			sep.setCssStyles({
				width: "2px",
				height: "70%",
				backgroundColor: "var(--color-base-35)",
				margin: "0 10px",
			});
		}

		const refreshSpan = statusBarEl.createEl("span", { text: " " });
		setIcon(refreshSpan, "refresh-cw");
		refreshSpan.setCssStyles({
			cursor: "pointer",
			marginLeft: "10px",
		});
		refreshSpan.onclick = () => {
			this.updateStatusBar();
		};

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-modal-simple",
			name: "Open modal (simple)",
			callback: () => {
				new ProjectsTimerModal(this.app).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "replace-selected",
			name: "Replace selected content",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				editor.replaceSelection("Projects Timer editor command");
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "open-modal-complex",
			name: "Open modal (complex)",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new ProjectsTimerModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
				return false;
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ProjectsTimerSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.reloadAllTasks();
			this.reloadAllProjectCards();
			this.updateStatusBar();
		});

		this.app.vault.on("create", async (newFile) => {
			const tasks = await this.findTasksInFile(newFile);
			if (tasks.length) {
				this.allTasks.next([...this.allTasks.value, ...tasks]);
			}
		});

		this.app.vault.on("modify", async (file) => {
			// Checking if the tasks in the file have changed
			const tasks = this.allTasks.value;
			const removedTasksHashes = new Set<string>();
			const filteredTasks = tasks.filter((task) => {
				const shouldRemove = task.file.path === file.path;
				if (shouldRemove) {
					removedTasksHashes.add(makeTaskHash(task));
					return false;
				}
				return true;
			});

			const tasksInFile = await this.findTasksInFile(file);
			if (tasks.length === filteredTasks.length && !tasksInFile.length) {
				// No tasks change
				return;
			}

			if (tasksInFile.length === removedTasksHashes.size) {
				if (
					tasksInFile.every((t) =>
						removedTasksHashes.has(makeTaskHash(t)),
					)
				) {
					// All new tasks were already in the list before
					return;
				}
			}

			// The tasks did change.
			this.allTasks.next([...filteredTasks, ...tasksInFile]);
		});

		this.app.vault.on("modify", async (file) => {
			if (!(file instanceof TFile)) return;
			if (!file.path.endsWith(".md")) return;
			this.updateStatusBar();
		});

		this.app.vault.on("create", async (newFile) => {
			const card = await this.findProjectCard(newFile);
			if (card) {
				this.allProjectCards.next([...this.allProjectCards.value, card]);
			}
		});

		this.app.vault.on("modify", async (file) => {
			if (!(file instanceof TFile)) return;
			const newCard = await this.findProjectCard(file);
			const withoutFile = this.allProjectCards.value.filter(
				(card) => card.file.path !== file.path,
			);
			this.allProjectCards.next(
				newCard ? [...withoutFile, newCard] : withoutFile,
			);
		});
	}

	allTasks = new BehaviorSubject<Task[]>([]);
	allProjectCards = new BehaviorSubject<ProjectCard[]>([]);

	private async findTasksInFile(file: TAbstractFile): Promise<Task[]> {
		if (!(file instanceof TFile)) return [];
		if (!file.path.endsWith(".md")) return [];

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");

		const props = this.parseFileProperties(lines);
		let projectFile: TFile | null = null;
		if (props.project) {
			projectFile = this.findFileFromLink(props.project);
		}
		if (!projectFile) {
			// Checking if this file is a project file
			for (const line of lines) {
				if (line.startsWith("```project")) {
					projectFile = file;
					break;
				}
			}
		}

		return parseTasks(lines, file, projectFile);
	}

	private async reloadAllTasks() {
		const allFiles = this.app.vault.getAllLoadedFiles();
		// We read the content of all the files, and we find the task tags
		let allTasks = [] as Task[];
		for (const file of allFiles) {
			if (!(file instanceof TFile)) continue;
			const tasks = await this.findTasksInFile(file);
			allTasks.push(...tasks);
		}
		this.allTasks.next(allTasks);
	}

	private async findProjectCard(
		file: TAbstractFile,
	): Promise<ProjectCard | null> {
		if (!(file instanceof TFile)) return null;
		if (!file.path.endsWith(".md")) return null;

		const content = await this.app.vault.adapter.read(file.path);
		if (!content.includes("```project")) return null;

		const card = parseProjectCard({
			file,
			content,
		});

		return card;
	}

	private async reloadAllProjectCards() {
		const projectFiles = this.getProjectFiles();
		const cards: ProjectCard[] = [];

		for (const file of projectFiles) {
			const card = await this.findProjectCard(file);
			if (card) cards.push(card);
		}

		this.allProjectCards.next(cards);
	}

	onunload() {}

	async loadSettings() {
		this.data = await PluginData.load(
			DEFAULT_SETTINGS,
			() => this.loadData(),
			(data) => this.saveData(data),
		);
		this.settings = this.data.settings;
	}

	/** Saves settings together with the sync state (both live in data.json). */
	async saveSettings() {
		await this.data.save();
	}

	private findProjectBlock(contentLines: string[]) {
		let startLine = 0;
		let lineEnd = 0;
		for (let i = 0; i < contentLines.length; i++) {
			const line = contentLines[i];
			if (!line) continue;
			if (line === "```project") {
				startLine = i + 1;
				continue;
			}
			if (startLine && line === "```") {
				lineEnd = i;
				break;
			}
		}

		if (!startLine || !lineEnd) {
			return null;
		}

		return {
			startLine,
			lineEnd,
		};
	}

	private parseFileProperties(
		contentLines: string[],
	): Record<string, string> {
		if (contentLines[0] !== "---") return {};
		const props = {} as Record<string, string>;

		for (const contentLine of contentLines) {
			const colonIdx = contentLine.indexOf(":");
			if (colonIdx < 0) continue;
			const key = contentLine.slice(0, colonIdx).trim();
			let value = contentLine.slice(colonIdx + 1).trim();
			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1);
			}
			props[key] = value;
		}

		return props;
	}

	async addActivityToFile(
		file: TFile,
		durationMins: number,
		description: string,
	): Promise<void> {
		const content = await this.app.vault.read(file);
		const contentLines = content.split("\n");

		const lines = this.findProjectBlock(contentLines);
		if (!lines) {
			new Notice("No project block found in this file...");
			return;
		}

		const { startLine } = lines;

		if (!startLine) {
			new Notice("No project block found in this file");
			return;
		}

		const today = localDay();
		const newLine = `${today};${durationMins};${description}`;

		contentLines.splice(startLine, 0, newLine);

		await this.app.vault.modify(file, contentLines.join("\n"));
	}

	getProjectFiles(): TFile[] {
		const projectFolder = this.settings.projectsLocation;
		return this.app.vault
			.getAllLoadedFiles()
			.filter(
				(f): f is TFile =>
					f instanceof TFile &&
					f.path.endsWith(".md") &&
					(!projectFolder || f.path.startsWith(projectFolder)),
			);
	}

	async parseActivities(infos: {
		file?: TFile;
		blockContent?: string;
	}): Promise<Activity[]> {
		if (infos.file == null && infos.blockContent == null) {
			throw new Error("No file or block content provided");
		}

		if (infos.file == null && infos.blockContent == "") {
			// No activities yet.
			return [];
		}

		let blockContent = infos.blockContent ?? "";

		if (!blockContent) {
			const fileContent = await this.app.vault.read(infos.file!);
			const fileLines = fileContent.split("\n");
			let inProjectBlock = false;
			for (const line of fileLines) {
				if (line === "```project") {
					inProjectBlock = true;
					continue;
				}
				if (!inProjectBlock) continue;
				if (line === "```") break;
				blockContent += line + "\n";
			}
			blockContent = blockContent.trim();
		}

		const lines = blockContent
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);

		const activities: Activity[] = lines
			.map((line) => {
				const parts = line.split(";").map((p) => p.trim());
				if (parts.length < 3) return null;
				return {
					date: parts[0] ?? "",
					duration: +parts[1]!,
					description: parts[2] ?? "",
				};
			})
			.filter(Boolean) as Activity[];

		return activities;
	}

	async updateStatusBar() {
		const { hourlyRate } = this.settings;
		let totalRevenueLast30Days = 0;
		let totalWorkedToday = 0;
		let totalWorkedThisWeek = 0;

		const now = new Date();
		const todayStr = this.formatDate(now);
		const thirtyDaysAgo = new Date(now);
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		const dayOfWeek = now.getDay();
		const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
		const weekStart = new Date(now);
		weekStart.setDate(weekStart.getDate() + mondayOffset);
		weekStart.setHours(0, 0, 0, 0);

		const projectFiles = this.getProjectFiles();

		for (const file of projectFiles) {
			const activities = await this.parseActivities({ file });

			for (const act of activities) {
				const isToday = act.date === todayStr;
				const d = new Date(act.date + "T00:00:00");
				const isThisWeek = d >= weekStart;
				const isInLast30Days = d >= thirtyDaysAgo;

				if (isToday) {
					totalWorkedToday += act.duration;
				}
				if (isThisWeek) {
					totalWorkedThisWeek += act.duration;
				}
				if (isInLast30Days) {
					totalRevenueLast30Days += (act.duration * hourlyRate) / 60;
				}
			}
		}

		const dailyExpected = this.settings.hoursPerDay * 60;
		const weeklyExpected =
			this.settings.hoursPerDay * this.settings.daysPerWeek * 60;

		const revenueStr =
			hourlyRate > 0 ? this.formatMoney(totalRevenueLast30Days) : "";

		this.revenueSpan.setText(revenueStr);

		this.todayWorkedSpan.setText(
			this.formatDuration(totalWorkedToday, false),
		);
		this.todayWorkedSpan.style.color = this.getColorForWorkTime(
			totalWorkedToday,
			dailyExpected,
		);

		this.weekWorkedSpan.setText(
			this.formatDuration(totalWorkedThisWeek, false),
		);
		this.weekWorkedSpan.style.color = this.getColorForWorkTime(
			totalWorkedThisWeek,
			weeklyExpected,
		);
	}

	getColorForWorkTime(workedMins: number, expectedMins: number): string {
		if (workedMins < expectedMins) return "var(--text-error)";
		if (workedMins < expectedMins * 1.2) return "var(--text-success)";
		return "#FFD800";
	}

	async openKanbanView() {
		const { workspace } = this.app;
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Unable to open kanban view");
			return;
		}
		await leaf.setViewState({
			type: TASKS_KANBAN_VIEW_TYPE,
			active: true,
		});
		workspace.revealLeaf(leaf);
	}

	async openProjectsListView() {
		const { workspace } = this.app;
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Unable to open projects list view");
			return;
		}
		await leaf.setViewState({
			type: PROJECTS_LIST_VIEW_TYPE,
			active: true,
		});
		workspace.revealLeaf(leaf);
	}

	async openActivitiesView() {
		const { workspace } = this.app;
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Unable to open activities view");
			return;
		}
		await leaf.setViewState({
			type: ACTIVITIES_VIEW_TYPE,
			active: true,
		});
		workspace.revealLeaf(leaf);
	}
}

class ProjectsTimerModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
