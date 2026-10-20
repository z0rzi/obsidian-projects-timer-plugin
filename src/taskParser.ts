import type { TFile } from "obsidian";
import { splitBlockId } from "./blockId";
import { Task, TASKS_TYPES } from "./types";

const DEFAULT_PRIORITY = 1;
const PRIORITY_TOKEN = /^p([0-5])$/;
const REVIEW_TOKEN = "pr";

/**
 * Tag tasks: a line starting with `#<type> ` opens a Task, the following
 * non-blank lines are its description, a blank line or another tag ends it.
 */
export function parseTasks(
	lines: string[],
	file: TFile,
	projectFile: TFile | null,
): Task[] {
	const tasks: Task[] = [];
	let currentTask: Task | null = null;

	for (let lineNr = 0; lineNr < lines.length; lineNr++) {
		const line = lines[lineNr];
		if (!line?.trim()) {
			if (currentTask) tasks.push(currentTask);
			currentTask = null;
			continue;
		}

		const taskType = TASKS_TYPES.find((t) => line.startsWith(`#${t.tag} `));
		if (taskType) {
			if (currentTask) tasks.push(currentTask);
			const rest = line.slice(taskType.tag.length + 2).trimStart();
			const [firstWord = "", ...others] = rest.split(" ");
			const match = PRIORITY_TOKEN.exec(firstWord);
			const review = firstWord === REVIEW_TOKEN;
			const hasToken = !!match || review;
			const { text: title, blockId } = splitBlockId(
				hasToken ? others.join(" ") : rest,
			);
			currentTask = {
				id: `${file.path}:${lineNr}`,
				title,
				...(blockId ? { blockId } : {}),
				raw: line,
				priority: match ? +match[1]! : DEFAULT_PRIORITY,
				status: review ? "review" : "priority",
				file,
				projectFile: projectFile ?? undefined,
				description: "",
				line: lineNr,
				type: taskType.tag,
			};
			continue;
		}

		if (currentTask) currentTask.description += line + "\n";
	}
	if (currentTask) tasks.push(currentTask);

	return tasks;
}
