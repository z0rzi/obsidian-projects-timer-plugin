import type { TFile } from "obsidian";
import { splitBlockId } from "../blockId";
import { extractCheckboxItems, findTasksHeadingSection } from "../projectCards";
import type { Priority, PushedTaskType } from "../remote/api";
import { parseTasks, readIndentedBody } from "../taskParser";
import { taskProject, type ProjectOfLink } from "./projectLink";

/**
 * What the Client app sees of one Task line and its indented body (shared as
 * the Task's Description).
 */
export interface LocalTask {
	path: string;
	line: number;
	/** Line content when read, to find it again when writing the block ID. */
	raw: string;
	/** `^id` at the end of the line: the app id once pushed. */
	blockId?: string;
	/**
	 * Project note the Task belongs to: the one its line or bare-link first
	 * body line names, else the note's (the file itself, or its `project:`
	 * frontmatter); null = standalone.
	 */
	projectPath: string | null;
	/** Why the Task can't be pushed as written (two Projects named). */
	projectError?: string;
	title: string;
	/** null for a `#done` line: its tag is gone, the type is its base's in the app. */
	type: PushedTaskType | null;
	/** A Project step (a checkbox under a Project note's Tasks heading); false for a Tag task. */
	step: boolean;
	/** `p0`–`p5`, `pr` or `pz`, `pq` for a `#quick` Tag task without token; null = inherit the Project's (Project step without token), or Done. */
	priority: Priority | null;
	/** Terminé: a `#done` line or a ticked step. */
	done: boolean;
	/** Date of `#done <date>`, or of a done Project step (first word once its type tag is out: `- [x] #bug <date> …`). */
	doneOn?: string;
	/**
	 * The body with the first body line's indentation removed from every line;
	 * "" without body. A first line naming the Project is not part of it.
	 */
	description: string;
}

const PRIVATE = /(^|\s)#private(\s|$)/;
const DONE_LINE = /^#done(?=\s|$)(?:\s+(\d{4}-\d{2}-\d{2})(?=\s|$))?\s*(.*)$/;

/** An open line at the Priority of its token; no token = none (a step inherits). */
function fromToken(priority: Priority | undefined): Pick<LocalTask, "priority" | "done"> {
	return { priority: priority ?? null, done: false };
}

const TAB_WIDTH = 4;

/**
 * The leading tabs and spaces of `line`, read up to `maxColumns` columns (a
 * tab reaching the next multiple of `TAB_WIDTH`): their width in columns and
 * their length in characters.
 */
function leadingIndent(line: string, maxColumns = Infinity): { width: number; length: number } {
	let width = 0;
	let length = 0;
	while (width < maxColumns && (line[length] === " " || line[length] === "\t")) {
		width += line[length] === "\t" ? TAB_WIDTH - (width % TAB_WIDTH) : 1;
		length++;
	}
	return { width, length };
}

/**
 * The body as shared: the first line's indentation (tabs or spaces) removed
 * from every line, relative indent kept. Indents compare by width, so tabs
 * and spaces may mix; a tab cut through leaves its extra columns as spaces,
 * a line indented less than the first loses only what it has.
 */
export function deindent(body: string): string {
	const columns = leadingIndent(body).width;
	return body
		.split("\n")
		.map((line) => {
			const { width, length } = leadingIndent(line, columns);
			return " ".repeat(Math.max(0, width - columns)) + line.slice(length);
		})
		.join("\n");
}

/**
 * The Project and Description of the Tag task on line `at`: what its line or
 * body names (`taskProject`), else `notePath`.
 */
function projectAndBody(lines: string[], at: number, notePath: string | null, projectOf: ProjectOfLink) {
	const body = readIndentedBody(lines, at);
	const named = taskProject(lines[at]!, body, projectOf);
	const rest = named.bodyLink ? body.slice(1) : body;
	const first = rest.findIndex((line) => line !== "");
	return {
		projectPath: named.projectPath ?? notePath,
		...(named.error ? { projectError: named.error } : {}),
		description: deindent(first < 0 ? "" : rest.slice(first).join("\n")),
	};
}

/**
 * Tag tasks of a file (`#task`, `#bug`, `#quick`, `#wait`, `#idea`, and `#done` lines),
 * minus `#private` ones. `projectPath` is the note's Project; `projectOf`
 * finds the Project note a link of the file targets (none by default: links
 * are text).
 */
export function readTagTasks(
	path: string,
	content: string,
	projectPath: string | null,
	projectOf: ProjectOfLink = () => null,
): LocalTask[] {
	const lines = content.split("\n");
	const out: LocalTask[] = [];
	for (const t of parseTasks(lines, { path } as TFile, null)) {
		if (PRIVATE.test(t.raw)) continue;
		const mapped = fromToken(t.priority);
		const { projectPath: project, ...rest } = projectAndBody(lines, t.line, projectPath, projectOf);
		out.push({
			path,
			line: t.line,
			raw: t.raw,
			...(t.blockId ? { blockId: t.blockId } : {}),
			projectPath: project,
			title: t.title.trim(),
			type: t.type,
			step: false,
			...mapped,
			...rest,
		});
	}
	lines.forEach((raw, line) => {
		const m = raw.match(DONE_LINE);
		if (!m || PRIVATE.test(raw)) return;
		const { text, blockId } = splitBlockId(m[2]!);
		if (!text.trim()) return;
		const { projectPath: project, ...rest } = projectAndBody(lines, line, projectPath, projectOf);
		out.push({
			path,
			line,
			raw,
			...(blockId ? { blockId } : {}),
			projectPath: project,
			title: text.trim(),
			type: null,
			step: false,
			priority: null,
			done: true,
			...(m[1] ? { doneOn: m[1] } : {}),
			...rest,
		});
	});
	return out.sort((a, b) => a.line - b.line);
}

/**
 * Project steps: top-level checkboxes under the Tasks heading of a Project
 * note, minus `#private` ones. The type comes from the step's tag (`task` without).
 */
export function readProjectSteps(path: string, content: string): LocalTask[] {
	const lines = content.split("\n");
	const section = findTasksHeadingSection(lines);
	if (!section) return [];
	return extractCheckboxItems(lines, section.start, section.end)
		.filter((item) => !PRIVATE.test(item.raw))
		.map((item) => ({
			path,
			line: item.line,
			raw: item.raw,
			...(item.blockId ? { blockId: item.blockId } : {}),
			projectPath: path,
			title: item.text.trim(),
			type: item.type,
			step: true,
			...(item.checked
				? { priority: null, done: true, ...(item.doneOn ? { doneOn: item.doneOn } : {}) }
				: fromToken(item.override)),
			description: deindent(item.body),
		}));
}
