import { ItemView, WorkspaceLeaf, setIcon, TFile } from "obsidian";
import type ProjectsTimerPlugin from "../main";

export const PROJECTS_LIST_VIEW_TYPE = "projects-list-view";

export class ProjectsListView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ProjectsTimerPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return PROJECTS_LIST_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Projects list";
	}

	getIcon(): string {
		return "file-check";
	}

	async onOpen() {
		await this.render();
	}

	async render() {
		const container = this.containerEl.children[1];
		if (!container) return;
		container.empty();

		(container as HTMLElement).style.display = "flex";
		(container as HTMLElement).style.flexDirection = "column";
		(container as HTMLElement).style.padding = "12px";

		const header = container.createDiv();
		header.style.display = "flex";
		header.style.justifyContent = "space-between";
		header.style.alignItems = "center";
		header.style.marginBottom = "12px";

		const title = header.createEl("h3", { text: "Projects" });
		title.style.margin = "0";

		const reloadBtn = header.createEl("button");
		setIcon(reloadBtn, "refresh-cw");
		reloadBtn.style.cursor = "pointer";
		reloadBtn.style.padding = "4px 8px";
		reloadBtn.addEventListener("click", async () => {
			await this.render();
		});

		const projectFiles = this.plugin.getProjectFiles();

		if (projectFiles.length === 0) {
			container.createEl("p", {
				text: "No project files found.",
			});
			return;
		}

		interface ProjectData {
			file: TFile;
			sources: { duration: number }[];
			activities: { date: string; duration: number }[];
			lastActivityDate: string;
		}

		const projects: ProjectData[] = [];
		for (const file of projectFiles) {
			try {
				const { sources, activities } =
					await this.plugin.parseProject({ file });
				const lastDate =
					activities.length > 0
						? activities
								.map((a) => a.date)
								.sort()
								.last() ?? ""
						: "";
				projects.push({ file, sources, activities, lastActivityDate: lastDate });
			} catch {
				continue;
			}
		}

		projects.sort((a, b) => {
			if (!a.lastActivityDate && !b.lastActivityDate) return 0;
			if (!a.lastActivityDate) return 1;
			if (!b.lastActivityDate) return -1;
			return b.lastActivityDate.localeCompare(a.lastActivityDate);
		});

		const listContainer = container.createDiv();
		listContainer.style.display = "flex";
		listContainer.style.flexDirection = "column";
		listContainer.style.gap = "6px";

		for (const project of projects) {
			this.renderProjectRow(listContainer, project);
		}
	}

	private renderProjectRow(
		container: HTMLElement,
		project: { file: TFile; sources: { duration: number }[]; activities: { duration: number }[] },
	) {
		const { file, sources, activities } = project;

		const totalAvailable = sources.reduce(
			(s, t) => s + t.duration,
			0,
		);
		const totalWorked = activities.reduce(
			(s, a) => s + a.duration,
			0,
		);
		const percentage = totalAvailable > 0 ? totalWorked / totalAvailable : 0;

		const row = container.createDiv();
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.padding = "8px 10px";
		row.style.borderRadius = "6px";
		row.style.cursor = "pointer";
		row.style.gap = "10px";
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
				leaf.openFile(file);
			}
		});

		const progressContainer = row.createSpan();
		progressContainer.style.flexShrink = "0";
		this.drawCircularProgress(progressContainer, percentage);

		const nameEl = row.createSpan({ text: file.basename });
		nameEl.style.flex = "1";
		nameEl.style.overflow = "hidden";
		nameEl.style.textOverflow = "ellipsis";
		nameEl.style.whiteSpace = "nowrap";

		const timeEl = row.createSpan({
			text: `${this.plugin.formatDuration(totalWorked)} / ${this.plugin.formatDuration(totalAvailable)}`,
		});
		timeEl.style.flexShrink = "0";
		timeEl.style.color = "var(--text-faint)";
		timeEl.style.fontSize = "0.8em";
		timeEl.style.fontVariantNumeric = "tabular-nums";
	}

	private drawCircularProgress(
		container: HTMLElement,
		percentage: number,
	) {
		const size = 10;
		const thickness = 3;

		const canvas = container.createEl("canvas");
		canvas.width = size + thickness;
		canvas.height = size + thickness;
		canvas.style.width = size + thickness + "px";
		canvas.style.height = size + thickness + "px";

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const cx = (size + thickness) / 2;
		const cy = (size + thickness) / 2;
		const radius = size / 2;

		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
		ctx.strokeStyle = "#1e1e1e";
		ctx.lineWidth = thickness;
		ctx.stroke();

		if (percentage > 0) {
			let color: string;
			if (percentage < 0.1) {
				color = "#f7d794";
			} else if (percentage < 0.4) {
				color = "#f19066";
			} else if (percentage < 0.6) {
				color = "#e15f41";
			} else if (percentage < 0.9) {
				color = "#e66767";
			} else {
				color = "#c44569";
			}

			ctx.beginPath();
			ctx.arc(
				cx,
				cy,
				radius,
				-Math.PI / 2,
				-Math.PI / 2 + 2 * Math.PI * Math.min(percentage, 1),
			);
			ctx.strokeStyle = color;
			ctx.lineWidth = thickness;
			ctx.stroke();
		}
	}

	async onClose() {}
}
