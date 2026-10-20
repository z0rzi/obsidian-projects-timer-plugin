import { Notice, type App, type TFile } from "obsidian";
import {
	processLine,
	rewriteStepToken,
	rewriteTaskTag,
	toggleCheckbox,
	type StatusToken,
	type WriteResult,
} from "../../lineWriter";
import type { ProjectCard, ProjectCardItem, Task } from "../../types";
import { vaultFiles } from "../../sync/vaultFiles";

/**
 * The kanban's vault writes. Lines are found by identity (block ID, or the
 * line as loaded); a line that changed since is left alone with a notice.
 * Each returns whether the vault changed.
 */
export class CardWrites {
	constructor(private readonly app: App) {}

	taskTag(task: Task, newTag: string): Promise<boolean> {
		return this.line(task.file, "Failed to update task tag", (content) => rewriteTaskTag(content, task, newTag));
	}

	stepToken(file: TFile, item: ProjectCardItem, token: StatusToken | null): Promise<boolean> {
		return this.line(file, "Failed to update project step", (content) => rewriteStepToken(content, item, token));
	}

	async toggleStep(card: ProjectCard, line: number): Promise<boolean> {
		const item = [...card.items, ...card.overrides].find((i) => i.line === line);
		if (!item) return false;
		return this.line(card.file, "Failed to update task checkbox", (content) => toggleCheckbox(content, item));
	}

	async projectPriority(card: ProjectCard, priority: number): Promise<boolean> {
		try {
			await this.app.fileManager.processFrontMatter(card.file, (fm: Record<string, unknown>) => {
				fm.priority = priority;
			});
			return true;
		} catch {
			new Notice("Failed to update project priority");
			return false;
		}
	}

	private async line(file: TFile, failMessage: string, rewrite: (content: string) => WriteResult): Promise<boolean> {
		try {
			const result = await processLine(vaultFiles(this.app).process, file.path, rewrite);
			if (result.ok) return result.changed;
			new Notice(`Not updated: the line in ${file.basename} changed since the kanban loaded. Reload and try again.`);
		} catch {
			new Notice(failMessage);
		}
		return false;
	}
}
