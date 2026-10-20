import type { TFile } from "obsidian";
import { splitBlockId } from "./blockId";
import { Task, TaskStatus, TASKS_TYPES } from "./types";

const DEFAULT_PRIORITY = 1;
const PRIORITY_TOKEN = /^p([0-5])$/;
const REVIEW_TOKEN = "pr";

/** Regex source of the status token: lowercase `p0`-`p5` or `pr`. */
export const STATUS_TOKEN_SOURCE = "p[0-5]|pr";

export type StatusToken = { priority: number; status: TaskStatus };

/**
 * Status token = first word of `text`, lowercase, whole word.
 * Returns the token (null if absent) and the text after it.
 */
export function readStatusToken(text: string): { token: StatusToken | null; rest: string } {
	const [firstWord = "", ...others] = text.split(" ");
	const match = PRIORITY_TOKEN.exec(firstWord);
	if (match) return { token: { priority: +match[1]!, status: "priority" }, rest: others.join(" ") };
	if (firstWord === REVIEW_TOKEN) return { token: { priority: DEFAULT_PRIORITY, status: "review" }, rest: others.join(" ") };
	return { token: null, rest: text };
}

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
			const { token, rest: afterToken } = readStatusToken(rest);
			const { text: title, blockId } = splitBlockId(afterToken);
			currentTask = {
				id: `${file.path}:${lineNr}`,
				title,
				...(blockId ? { blockId } : {}),
				raw: line,
				priority: token?.priority ?? DEFAULT_PRIORITY,
				status: token?.status ?? "priority",
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
