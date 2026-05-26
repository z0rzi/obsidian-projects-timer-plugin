import { ItemView, WorkspaceLeaf, setIcon, TFile } from "obsidian";
import type ProjectsTimerPlugin from "../main";
import { Activity } from "../types";

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

	private async collectActivities(): Promise<ProjectActivity[]> {
		const projectFiles = this.plugin.getProjectFiles();
		const allActivities: ProjectActivity[] = [];

		for (const file of projectFiles) {
			try {
				const { activities } = await this.plugin.parseProject({
					file,
				});
				for (const act of activities) {
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
				(f): f is TFile =>
					f instanceof TFile && f.path.endsWith(".md"),
			);

		const items: DoneItem[] = [];

		for (const file of allFiles) {
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (!line || !line.includes("#done")) continue;

				const dateMatch = line.match(
					/#done\b.*?(\d{4}-\d{2}-\d{2})/,
				);
				const date = dateMatch ? dateMatch[1]! : "";

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

		row.addEventListener("mouseenter", () => {
			row.style.backgroundColor = "var(--background-modifier-hover)";
		});
		row.addEventListener("mouseleave", () => {
			row.style.backgroundColor = "";
		});
		row.addEventListener("click", () => {
			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) {
				leaf.openFile(item.projectFile);
			}
		});

		const descEl = row.createSpan({ text: item.description });
		descEl.style.overflow = "hidden";
		descEl.style.textOverflow = "ellipsis";
		descEl.style.display = "-webkit-box";
		descEl.style.webkitLineClamp = "2";
		descEl.style.webkitBoxOrient = "vertical";
		descEl.style.color = "var(--text-normal)";
		descEl.style.lineHeight = "1.4";

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

	async onClose() {}
}
