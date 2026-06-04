import { ItemView, WorkspaceLeaf, setIcon, TFile } from "obsidian";
import type ProjectsTimerPlugin from "../main";
import { Activity } from "../types";
import {
	ExportActivitiesModal,
	ExportOptions,
} from "../ui/ExportActivitiesModal";

export const ACTIVITIES_VIEW_TYPE = "activities-view";

interface ProjectActivity extends Activity {
	projectName: string;
	projectFile: TFile;
}

interface DoneItem {
	line: number;
	file: TFile;
	date: string;
	text: string;
}

export class ActivitiesView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ProjectsTimerPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return ACTIVITIES_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Recent activity";
	}

	getIcon(): string {
		return "ticket-check";
	}

	async onOpen() {
		await this.render();
	}

	private getOneYearAgoDateString(): string {
		const oneYearAgo = new Date();
		oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
		return this.plugin.formatDate(oneYearAgo);
	}

	private async collectActivities(): Promise<ProjectActivity[]> {
		const projectFiles = this.plugin.getProjectFiles();
		const allActivities: ProjectActivity[] = [];
		const cutoff = this.getOneYearAgoDateString();

		for (const file of projectFiles) {
			try {
				const { activities } = await this.plugin.parseProject({
					file,
				});
				for (const act of activities) {
					if (act.date < cutoff) continue;
					allActivities.push({
						...act,
						projectName: file.basename,
						projectFile: file,
					});
				}
			} catch {
				continue;
			}
		}

		allActivities.sort((a, b) => b.date.localeCompare(a.date));
		return allActivities;
	}

	private async collectDoneItems(): Promise<DoneItem[]> {
		const allFiles = this.app.vault
			.getAllLoadedFiles()
			.filter(
				(f): f is TFile => f instanceof TFile && f.path.endsWith(".md"),
			);

		const items: DoneItem[] = [];
		const cutoff = this.getOneYearAgoDateString();

		for (const file of allFiles) {
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (!line || !line.includes("#done")) continue;

				const dateMatch = line.match(/#done\b.*?(\d{4}-\d{2}-\d{2})/);
				const date = dateMatch ? dateMatch[1]! : "";

				// Skip done items with a date older than 1 year ago, or with no date
				if (!date || date < cutoff) continue;

				let text = line;
				if (date) {
					text = text.replace(date, "");
				}
				text = text.replace(/#done/g, "").replace(/\s+/g, " ").trim();

				items.push({ line: i, file, date, text });
			}
		}

		items.sort((a, b) => {
			if (!a.date && !b.date) return 0;
			if (!a.date) return 1;
			if (!b.date) return -1;
			return b.date.localeCompare(a.date);
		});

		return items;
	}

	async render() {
		const container = this.containerEl.children[1];
		if (!container) return;
		container.empty();

		this.selectedActivities.clear();

		(container as HTMLElement).style.display = "flex";
		(container as HTMLElement).style.flexDirection = "column";
		(container as HTMLElement).style.height = "100%";
		(container as HTMLElement).style.padding = "12px";

		const header = container.createDiv();
		header.style.display = "flex";
		header.style.justifyContent = "space-between";
		header.style.alignItems = "center";
		header.style.marginBottom = "12px";
		header.style.flexShrink = "0";

		const title = header.createEl("h3", { text: "Recent activity" });
		title.style.margin = "0";

		const reloadBtn = header.createEl("button");
		setIcon(reloadBtn, "refresh-cw");
		reloadBtn.style.cursor = "pointer";
		reloadBtn.style.padding = "4px 8px";
		reloadBtn.addEventListener("click", async () => {
			await this.render();
		});

		const columns = container.createDiv();
		columns.style.display = "flex";
		columns.style.gap = "12px";
		columns.style.flex = "1";
		columns.style.minHeight = "0";

		const [activities, doneItems] = await Promise.all([
			this.collectActivities(),
			this.collectDoneItems(),
		]);

		this.renderColumn(columns, "Recent activities", activities);
		this.renderColumn(columns, "Completed tasks", doneItems);

		this.renderFooter(container as HTMLElement);
	}

	private renderColumn(
		parent: HTMLElement,
		headerText: string,
		items: ProjectActivity[] | DoneItem[],
	) {
		const col = parent.createDiv();
		col.style.width = "50%";
		col.style.display = "flex";
		col.style.flexDirection = "column";
		col.style.minHeight = "0";

		const colHeader = col.createEl("h4", { text: headerText });
		colHeader.style.margin = "0 0 8px 0";
		colHeader.style.flexShrink = "0";

		const list = col.createDiv();
		list.style.flex = "1";
		list.style.overflowY = "auto";
		list.style.display = "flex";
		list.style.flexDirection = "column";
		list.style.gap = "6px";

		if (items.length === 0) {
			list.createEl("p", {
				text: "No items found.",
			}).style.color = "var(--text-muted)";
			return;
		}

		if (items[0] && "projectFile" in items[0]) {
			for (const item of items as ProjectActivity[]) {
				this.renderActivityRow(list, item);
			}
		} else {
			for (const item of items as DoneItem[]) {
				this.renderDoneRow(list, item);
			}
		}
	}

	private getActivityHash(activity: ProjectActivity) {
		return `${activity.date}_${activity.duration}_${activity.description}`;
	}

	selectedActivities = new Set<ProjectActivity>();
	activitiesAssignations = new Map<
		string,
		{
			domButton: HTMLElement;
			domRow: HTMLElement;
			key: string;
			activity: ProjectActivity;
		}
	>();

	private footerEl: HTMLElement | null = null;
	private groupCountEl: HTMLElement | null = null;
	private clearBtn: HTMLButtonElement | null = null;
	private groupButtonsContainer: HTMLElement | null = null;

	private attribution2color = new Map<string, string>();
	private getAttributionBgColor(key: string) {
		if (this.attribution2color.has(key)) {
			return this.attribution2color.get(key)!;
		}

		// const allAttributions = new Set(this.activitiesAssignations.values());
		const allColors = new Set([
			"#2f2935",
			"#352929",
			"#353229",
			"#29352a",
			"#293135",
			"#2c2935",
		]);

		for (const [, color] of this.attribution2color) {
			allColors.delete(color);
		}

		if (!allColors.size) {
			return "var(--text-faint)";
		}

		const color = allColors.values().next().value;
		this.attribution2color.set(key, color);
		return color;
	}

	private renderActivityRow(container: HTMLElement, item: ProjectActivity) {
		const row = container.createDiv();
		row.style.display = "flex";
		row.style.flexDirection = "column";
		row.style.padding = "6px 8px";
		row.style.borderRadius = "6px";
		row.style.cursor = "pointer";
		row.style.gap = "2px";
		row.style.fontSize = "0.9em";
		row.style.transition = "background-color 0.15s";

		const hash = this.getActivityHash(item);

		row.addEventListener("mouseenter", () => {
			if (!this.activitiesAssignations.has(hash)) {
				row.style.backgroundColor = "var(--background-modifier-hover)";
			}
		});
		row.addEventListener("mouseleave", () => {
			if (!this.activitiesAssignations.has(hash)) {
				row.style.backgroundColor = "";
			}
		});
		row.addEventListener("click", () => {
			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) {
				leaf.openFile(item.projectFile);
			}
		});

		const topDiv = row.createDiv();
		topDiv.style.display = "flex";

		const descEl = topDiv.createSpan({ text: item.description });
		descEl.style.overflow = "hidden";
		descEl.style.textOverflow = "ellipsis";
		descEl.style.display = "-webkit-box";
		descEl.style.webkitLineClamp = "2";
		descEl.style.webkitBoxOrient = "vertical";
		descEl.style.color = "var(--text-normal)";
		descEl.style.lineHeight = "1.4";

		const attribution = this.activitiesAssignations.get(hash);
		const attribButton = topDiv.createEl("button", {
			text: attribution?.key ?? "?",
		});
		if (attribution) {
			attribution.domRow = row;
			attribution.domButton = attribButton;
		}
		attribButton.style.marginLeft = "auto";
		attribButton.style.padding = "4px 8px";
		attribButton.style.borderRadius = "4px";
		attribButton.style.backgroundColor = "transparent";
		attribButton.style.border = "1px solid var(--text-faint)";
		attribButton.style.borderStyle = "dashed";
		attribButton.style.cursor = "pointer";
		attribButton.style.transition = "background-color 0.15s";

		let isListening = false;
		const onDocKey = (evt: KeyboardEvent) => {
			console.log('🥖', evt.key);
			if (evt.key === "Escape") {
				attribButton.innerHTML = "?";
				row.style.backgroundColor = "";

				document.removeEventListener("keydown", onDocKey);
				this.activitiesAssignations.delete(hash);
				this.updateFooter();
				isListening = false;
				return;
			}
			if (evt.key.length === 1) {
			this.activitiesAssignations.set(hash, {
						domRow: row,
						domButton: attribButton,
						key: evt.key,
						activity: item,
					});
				attribButton.innerHTML = evt.key;
				row.style.backgroundColor = this.getAttributionBgColor(evt.key);
				this.updateFooter();
			} else {
				attribButton.innerHTML = "?";
				row.style.backgroundColor = "";
			}
			document.removeEventListener("keydown", onDocKey);
			isListening = false;
		};
		attribButton.addEventListener("click", (clickEvt) => {
			clickEvt.stopPropagation();
			clickEvt.preventDefault();
			if (isListening) return;

			isListening = true;
			document.addEventListener("keydown", onDocKey);
			attribButton.innerHTML = "…";
		});
		attribButton.addEventListener("blur", () => {
			if (!isListening) return;
			document.removeEventListener("keydown", onDocKey);
			isListening = false;
			// restauring previous value
			const attribution = this.activitiesAssignations.get(hash);
			if (attribution) {
				attribButton.innerHTML = attribution.key;
				row.style.backgroundColor = this.getAttributionBgColor(
					attribution.key,
				);
			} else {
				attribButton.innerHTML = "?";
				row.style.backgroundColor = "";
			}
		});

		const bottomLine = row.createDiv();
		bottomLine.style.fontFamily = "var(--font-monospace)";
		bottomLine.style.color = "var(--text-faint)";
		bottomLine.style.fontSize = "0.8em";
		bottomLine.style.display = "flex";
		bottomLine.style.alignItems = "center";
		bottomLine.style.gap = "8px";

		const dateEl = bottomLine.createSpan({ text: item.date });
		dateEl.style.flexShrink = "0";
		dateEl.style.fontVariantNumeric = "tabular-nums";

		const durationEl = bottomLine.createSpan({
			text: this.plugin.formatDuration(item.duration),
		});
		durationEl.style.flexShrink = "0";
		durationEl.style.minWidth = "40px";
		durationEl.style.textAlign = "right";
		durationEl.style.fontVariantNumeric = "tabular-nums";

		const projectEl = bottomLine.createSpan({ text: item.projectName });
		projectEl.style.marginLeft = "auto";
		projectEl.style.flexShrink = "0";
	}

	private renderDoneRow(container: HTMLElement, item: DoneItem) {
		const row = container.createDiv();
		row.style.display = "flex";
		row.style.flexDirection = "column";
		row.style.padding = "6px 8px";
		row.style.borderRadius = "6px";
		row.style.cursor = "pointer";
		row.style.gap = "2px";
		row.style.fontSize = "0.9em";
		row.style.transition = "background-color 0.15s";

		row.addEventListener("mouseenter", () => {
			row.style.backgroundColor = "var(--background-modifier-hover)";
		});
		row.addEventListener("mouseleave", () => {
			row.style.backgroundColor = "";
		});
		row.addEventListener("click", () => {
			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) {
				leaf.openFile(item.file, {
					eState: { line: item.line },
				});
			}
		});

		const safeText = item.text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
		const highlightedText = safeText.replace(
			/\[(.+?)\]/g,
			'<span style="color: var(--text-faint)">[<span style="color: var(--text-accent);">$1</span>]</span>',
		);

		const textEl = row.createSpan();
		textEl.innerHTML = highlightedText;
		textEl.style.overflow = "hidden";
		textEl.style.textOverflow = "ellipsis";
		textEl.style.display = "-webkit-box";
		textEl.style.webkitLineClamp = "2";
		textEl.style.webkitBoxOrient = "vertical";
		textEl.style.color = "var(--text-normal)";
		textEl.style.lineHeight = "1.4";

		const dateEl = row.createSpan({ text: item.date || "" });
		dateEl.style.fontFamily = "var(--font-monospace)";
		dateEl.style.color = "var(--text-faint)";
		dateEl.style.fontSize = "0.8em";
		dateEl.style.fontVariantNumeric = "tabular-nums";
	}

	private renderFooter(container: HTMLElement) {
		this.footerEl = container.createDiv();
		this.footerEl.style.display = "flex";
		this.footerEl.style.alignItems = "center";
		this.footerEl.style.gap = "8px";
		this.footerEl.style.padding = "10px 0";
		this.footerEl.style.borderTop =
			"1px solid var(--background-modifier-border)";
		this.footerEl.style.flexShrink = "0";
		this.footerEl.style.marginTop = "8px";

		this.groupCountEl = this.footerEl.createSpan({
			text: "0 groups",
		});
		this.groupCountEl.style.color = "var(--text-muted)";
		this.groupCountEl.style.fontSize = "0.85em";
		this.groupCountEl.style.marginRight = "auto";

		this.clearBtn = this.footerEl.createEl("button", {
			text: "Clear Selected",
		});
		this.clearBtn.disabled = true;
		this.clearBtn.addEventListener("click", () => this.clearSelection());

		this.groupButtonsContainer = this.footerEl.createDiv();
		this.groupButtonsContainer.style.display = "flex";
		this.groupButtonsContainer.style.gap = "6px";

		this.updateFooter();
	}

	private getGroupKeys(): string[] {
		const keys = new Set<string>();
		for (const [, entry] of this.activitiesAssignations) {
			keys.add(entry.key);
		}
		return Array.from(keys).sort();
	}

	private getActivitiesForGroup(key: string): ProjectActivity[] {
		const activities: ProjectActivity[] = [];
		for (const [, entry] of this.activitiesAssignations) {
			if (entry.key === key) {
				activities.push(entry.activity);
			}
		}
		return activities;
	}

	private updateFooter() {
		const groupKeys = this.getGroupKeys();
		const count = groupKeys.length;

		if (this.groupCountEl) {
			this.groupCountEl.setText(`${count} group${count !== 1 ? "s" : ""}`);
		}
		if (this.clearBtn) {
			this.clearBtn.disabled = count === 0;
		}

		// Rebuild group export buttons
		if (this.groupButtonsContainer) {
			this.groupButtonsContainer.empty();
			for (const key of groupKeys) {
				const btn = this.groupButtonsContainer.createEl("button", {
					text: `Export group '${key}'`,
				});
				btn.addEventListener("click", () =>
					this.openExportModal(key),
				);
			}
		}
	}

	private clearSelection() {
		this.selectedActivities.clear();
		this.activitiesAssignations.clear();
		this.updateFooter();
		// Re-render to reset row visual states
		this.render();
	}

	private openExportModal(groupKey: string) {
		const activities = this.getActivitiesForGroup(groupKey);
		if (activities.length === 0) return;

		new ExportActivitiesModal(
			this.app,
			(options: ExportOptions) => {
				this.generateCsv(options, activities);
			},
			(raw: string) => this.plugin.parseTime(raw),
		).open();
	}

	private generateCsv(options: ExportOptions, activities: ProjectActivity[]) {
		if (activities.length === 0) return;

		let durations: number[];
		if (options.totalTimeMins != null) {
			durations = this.redistributeTime(
				activities.map((a) => a.duration),
				options.totalTimeMins,
			);
		} else {
			durations = activities.map((a) => a.duration);
		}

		const lines: string[] = [];

		// Mission reference as first data row if provided
		if (options.missionReference) {
			lines.push(options.missionReference);
		}

		// Header row
		lines.push("Date;Duration;Description;Project");

		// Data rows
		for (let i = 0; i < activities.length; i++) {
			const act = activities[i]!;
			const duration = durations[i]!;
			lines.push(
				`${act.date};${this.formatDurationFr(duration)};${act.description};${act.projectName}`,
			);
		}

		const csvContent = lines.join("\n");
		const dateStr = new Date().toISOString().split("T")[0];
		const refPart = options.missionReference
			? `_${options.missionReference}`
			: "";
		const filename = `Activity_report${refPart}_${dateStr}.csv`;

		this.downloadCsv(csvContent, filename);
	}

	private formatDurationFr(mins: number): string {
		const hoursPerDay = this.plugin.settings.hoursPerDay;
		const days = Math.floor(mins / 60 / hoursPerDay);
		if (days >= 2) {
			mins -= days * 60 * hoursPerDay;
		}
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		let out = "";
		if (days > 0) out += `${days}j `;
		if (h && m) return out + `${h}h${m}m`;
		if (h) return out + `${h}h`;
		if (m) return out + `${m}m`;
		if (out.length) return out.trim();
		return "0m";
	}

	private downloadCsv(content: string, filename: string) {
		const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	/**
	 * Redistributes activity durations proportionally to match a target total time.
	 * Rounds each activity to the nearest 10 minutes, then adjusts to match the exact total.
	 */
	private redistributeTime(
		originalDurations: number[],
		targetTotalMins: number,
	): number[] {
		const originalTotal = originalDurations.reduce((s, d) => s + d, 0);
		if (originalTotal === 0) return originalDurations.map(() => 0);

		// Step 1 & 2 & 3: Calculate proportional time and round to nearest 10
		const rawDurations = originalDurations.map(
			(d) => (d / originalTotal) * targetTotalMins,
		);
		const roundedDurations = rawDurations.map(
			(d) => Math.round(d / 10) * 10,
		);

		// Step 4: Adjust for rounding differences
		const roundedTotal = roundedDurations.reduce((s, d) => s + d, 0);
		let diff = targetTotalMins - roundedTotal;

		if (diff !== 0) {
			// Calculate rounding errors: positive means rounded up, negative means rounded down
			const errors = rawDurations.map(
				(raw, i) => roundedDurations[i]! - raw,
			);

			// Create index array sorted by error
			// If we need to add time (diff > 0): add 10min to activities rounded down the most (most negative error)
			// If we need to remove time (diff < 0): remove 10min from activities rounded up the most (most positive error)
			const indices = originalDurations.map((_, i) => i);
			if (diff > 0) {
				// Sort by error ascending (most negative first)
				indices.sort((a, b) => errors[a]! - errors[b]!);
			} else {
				// Sort by error descending (most positive first)
				indices.sort((a, b) => errors[b]! - errors[a]!);
			}

			let remaining = Math.abs(diff);
			let idx = 0;
			while (remaining >= 10 && idx < indices.length) {
				const i = indices[idx]!;
				if (diff > 0) {
					roundedDurations[i]! += 10;
				} else {
					// Don't go below 0
					if (roundedDurations[i]! >= 10) {
						roundedDurations[i]! -= 10;
					}
				}
				remaining -= 10;
				idx++;
			}
		}

		return roundedDurations;
	}

	async onClose() {}
}
