import type { TFile } from "obsidian";
import { splitBlockId } from "../blockId";
import { extractCheckboxItems, findTasksHeadingSection } from "../projectCards";
import type { PushedTaskStatus, PushedTaskType } from "../remote/api";
import { parseTasks, readIndentedBody, type StatusToken } from "../taskParser";

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
	/** Project note the Task belongs to (the file itself, or its `project:` frontmatter); null = standalone. */
	projectPath: string | null;
	title: string;
	/** null for a `#done` line: its tag is gone, the type is the one last pushed. */
	type: PushedTaskType | null;
	/** A Project step (a checkbox under a Project note's Tasks heading); false for a Tag task. */
	step: boolean;
	status: PushedTaskStatus;
	/** null = inherit the Project's (Project step without token), or no priority (À valider, Terminé). */
	priority: number | null;
	/** Date of `#done <date>`. */
	doneOn?: string;
	/** The body with the first body line's indentation removed from every line; "" without body. */
	description: string;
}

const PRIVATE = /(^|\s)#private(\s|$)/;
const DONE_LINE = /^#done(?=\s|$)(?:\s+(\d{4}-\d{2}-\d{2})(?=\s|$))?\s*(.*)$/;

function fromToken(token: StatusToken | null): Pick<LocalTask, "status" | "priority"> | null {
	if (!token) return null;
	if (token.status === "review") return { status: "a_valider", priority: null };
	if (token.priority === 0) return { status: "en_cours", priority: 0 };
	return { status: "a_faire", priority: token.priority };
}

/** The body as shared: the first line's indentation (tab or spaces) removed from every line. */
function deindent(body: string): string {
	const indent = /^\s*/.exec(body)![0];
	return body
		.split("\n")
		.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()))
		.join("\n");
}

/** Tag tasks of a file (`#task`, `#bug`, `#quick`, `#wait`, and `#done` lines), minus `#private` ones. */
export function readTagTasks(path: string, content: string, projectPath: string | null): LocalTask[] {
	const lines = content.split("\n");
	const out: LocalTask[] = [];
	for (const t of parseTasks(lines, { path } as TFile, null)) {
		if (PRIVATE.test(t.raw)) continue;
		const mapped = fromToken({ priority: t.priority, status: t.status })!;
		out.push({
			path,
			line: t.line,
			raw: t.raw,
			...(t.blockId ? { blockId: t.blockId } : {}),
			projectPath,
			title: t.title.trim(),
			type: t.type,
			step: false,
			...mapped,
			description: deindent(t.description),
		});
	}
	lines.forEach((raw, line) => {
		const m = raw.match(DONE_LINE);
		if (!m || PRIVATE.test(raw)) return;
		const { text, blockId } = splitBlockId(m[2]!);
		if (!text.trim()) return;
		out.push({
			path,
			line,
			raw,
			...(blockId ? { blockId } : {}),
			projectPath,
			title: text.trim(),
			type: null,
			step: false,
			status: "termine",
			priority: null,
			...(m[1] ? { doneOn: m[1] } : {}),
			description: deindent(readIndentedBody(lines, line).join("\n")),
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
				? { status: "termine" as const, priority: null }
				: (fromToken(item.override ?? null) ?? { status: "a_faire" as const, priority: null })),
			description: deindent(item.body),
		}));
}
