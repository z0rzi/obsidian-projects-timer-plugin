import type { TFile } from "obsidian";
import { splitBlockId } from "./blockId";
import type { Priority } from "./remote/api";
import { Task, TaskTagLabel, TASKS_TYPES } from "./types";

const DEFAULT_PRIORITY = 1;
/** Priority of a `#quick` Tag task without token: Rapide, never ranked. */
const QUICK_PRIORITY = "pq";
const PRIORITY_TOKEN = /^p([0-5])$/;
/** Priority tokens that are words: PR (À valider) and PZ (En hibernation). `pq` is never a token. */
const WORD_TOKENS = ["pr", "pz"] as const;

/** Regex source of the Priority token: lowercase `p0`-`p5`, `pr` or `pz`. */
export const PRIORITY_TOKEN_SOURCE = "p[0-5]|pr|pz";

/** Regex source of a day, `YYYY-MM-DD`. */
export const DAY_SOURCE = "\\d{4}-\\d{2}-\\d{2}";

/**
 * Priority token = first word of `text`, lowercase, whole word.
 * Returns the Priority it gives (null if absent) and the text after it.
 */
export function readPriorityToken(text: string): { priority: Priority | null; rest: string } {
	const [firstWord = "", ...others] = text.split(" ");
	const match = PRIORITY_TOKEN.exec(firstWord);
	if (match) return { priority: +match[1]! as Priority, rest: others.join(" ") };
	const word = WORD_TOKENS.find((t) => t === firstWord);
	if (word) return { priority: word, rest: others.join(" ") };
	return { priority: null, rest: text };
}

/** Regex source of a Project step's type tag: `#task`, `#bug`, `#quick`, `#wait` or `#idea`. */
export const TYPE_TAG_SOURCE = `#(?:${TASKS_TYPES.map((t) => t.tag).join("|")})`;

/**
 * Type tag of a Project step = first whole word of `text`, wherever it sits,
 * that is `#task`, `#bug`, `#quick`, `#wait` or `#idea` (later ones stay text). Returns
 * the type ("task" if absent) and `text` without that word, one space left
 * where it was.
 */
export function readTypeTag(text: string): { type: TaskTagLabel; rest: string } {
	const words = text.split(" ");
	for (const [at, word] of words.entries()) {
		const type = TASKS_TYPES.find((t) => word === `#${t.tag}`)?.tag;
		if (!type) continue;
		const before = words.slice(0, at).join(" ").trimEnd();
		const after = words.slice(at + 1).join(" ").trimStart();
		return { type, rest: [before, after].filter(Boolean).join(" ") };
	}
	return { type: "task", rest: text };
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
 * (`readIndentedBody`) is its description. Without token a `#quick` is
 * Rapide (`pq`), any other type P1.
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
		const { priority, rest: afterToken } = readPriorityToken(rest);
		const { text: title, blockId } = splitBlockId(afterToken);
		tasks.push({
			id: `${file.path}:${lineNr}`,
			title,
			...(blockId ? { blockId } : {}),
			raw: line,
			priority: priority ?? (taskType.tag === "quick" ? QUICK_PRIORITY : DEFAULT_PRIORITY),
			file,
			projectFile: projectFile ?? undefined,
			description: readIndentedBody(lines, lineNr).join("\n"),
			line: lineNr,
			type: taskType.tag,
		});
	}
	return tasks;
}
