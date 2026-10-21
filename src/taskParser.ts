import type { TFile } from "obsidian";
import { splitBlockId } from "./blockId";
import { Task, TaskStatus, TaskTagLabel, TASKS_TYPES } from "./types";

const DEFAULT_PRIORITY = 1;
const PRIORITY_TOKEN = /^p([0-5])$/;
const A_VALIDER_TOKEN = "pr";

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
	if (firstWord === A_VALIDER_TOKEN) return { token: { priority: DEFAULT_PRIORITY, status: "a_valider" }, rest: others.join(" ") };
	return { token: null, rest: text };
}

/** Regex source of a Project step's type tag: `#task`, `#bug`, `#quick` or `#wait`. */
export const TYPE_TAG_SOURCE = `#(?:${TASKS_TYPES.map((t) => t.tag).join("|")})`;

/**
 * Type tag of a Project step = first word of `text` when it is `#task`,
 * `#bug`, `#quick` or `#wait`. Returns the type ("task" if absent) and the
 * text after it.
 */
export function readTypeTag(text: string): { type: TaskTagLabel; rest: string } {
	const [firstWord = "", ...others] = text.split(" ");
	const type = TASKS_TYPES.find((t) => firstWord === `#${t.tag}`)?.tag;
	return type ? { type, rest: others.join(" ") } : { type: "task", rest: text };
}

/**
 * Body of the Task (or Project step) on line `at`: the lines after it with an
 * indent above zero, blank lines included while the next non-blank line is
 * still indented. The first line at indent zero (or `end`) ends it; blank
 * lines before the first or after the last body line are left out. Lines are
 * returned as written.
 */
export function readIndentedBody(lines: string[], at: number, end = lines.length): string[] {
	const body = lines.slice(at + 1, indentedBodyEnd(lines, at, end) + 1).map((line) => (line.trim() ? line : ""));
	const first = body.findIndex((line) => line !== "");
	return first < 0 ? [] : body.slice(first);
}

/** Index of the last line of the body `readIndentedBody` reads under line `at`; `at` itself when there is none. */
export function indentedBodyEnd(lines: string[], at: number, end = lines.length): number {
	let last = at;
	for (let i = at + 1; i < end; i++) {
		const line = lines[i] ?? "";
		if (!line.trim()) continue;
		if (!/^\s/.test(line)) break;
		last = i;
	}
	return last;
}

/**
 * Tag tasks: a line starting with `#<type> ` is a Task, its indented body
 * (`readIndentedBody`) is its description.
 */
export function parseTasks(
	lines: string[],
	file: TFile,
	projectFile: TFile | null,
): Task[] {
	const tasks: Task[] = [];
	for (let lineNr = 0; lineNr < lines.length; lineNr++) {
		const line = lines[lineNr] ?? "";
		const taskType = TASKS_TYPES.find((t) => line.startsWith(`#${t.tag} `));
		if (!taskType) continue;
		const rest = line.slice(taskType.tag.length + 2).trimStart();
		const { token, rest: afterToken } = readStatusToken(rest);
		const { text: title, blockId } = splitBlockId(afterToken);
		tasks.push({
			id: `${file.path}:${lineNr}`,
			title,
			...(blockId ? { blockId } : {}),
			raw: line,
			priority: token?.priority ?? DEFAULT_PRIORITY,
			status: token?.status ?? "priority",
			file,
			projectFile: projectFile ?? undefined,
			description: readIndentedBody(lines, lineNr).join("\n"),
			line: lineNr,
			type: taskType.tag,
		});
	}
	return tasks;
}
