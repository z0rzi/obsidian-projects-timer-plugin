import { splitBlockId } from "./blockId";
import { toggleCheckboxLine } from "./projectCards";
import { STATUS_TOKEN_SOURCE } from "./taskParser";

/** What the kanban knew about a line when it was loaded. */
export type LineRef = { line: number; raw: string; blockId?: string };

export type WriteResult =
	| { ok: true; content: string }
	| { ok: false; reason: "not-found" | "ambiguous" | "changed" };

type Located = { ok: true; index: number } | { ok: false; reason: "not-found" | "ambiguous" | "changed" };

function locateLine(lines: string[], ref: LineRef): Located {
	if (ref.blockId) {
		const hits: number[] = [];
		lines.forEach((line, i) => {
			if (splitBlockId(line).blockId === ref.blockId) hits.push(i);
		});
		if (hits.length === 1) return { ok: true, index: hits[0]! };
		return { ok: false, reason: hits.length ? "ambiguous" : "not-found" };
	}
	if (lines[ref.line] === ref.raw) return { ok: true, index: ref.line };
	return { ok: false, reason: "changed" };
}

function rewriteLine(content: string, ref: LineRef, rewrite: (line: string) => string | null): WriteResult {
	const lines = content.split("\n");
	const located = locateLine(lines, ref);
	if (!located.ok) return located;
	const newLine = rewrite(lines[located.index]!);
	if (newLine === null) return { ok: false, reason: "changed" };
	lines[located.index] = newLine;
	return { ok: true, content: lines.join("\n") };
}

const TAG_AND_TOKEN = new RegExp(`^#\\S+(\\s+(${STATUS_TOKEN_SOURCE})(?=\\s|$))?\\s*`);
const CHECKBOX_AND_TOKEN = new RegExp(`^(- \\[[ xX]\\] )(?:(?:${STATUS_TOKEN_SOURCE})(?: |$))?`);

/** Replaces the tag (and priority token) of a Tag task line, keeping title and block ID. */
export function rewriteTaskTag(content: string, ref: LineRef, newTag: string): WriteResult {
	return rewriteLine(content, ref, (line) => {
		if (!line.startsWith("#")) return null;
		const rest = line.replace(TAG_AND_TOKEN, "");
		return rest ? `${newTag} ${rest}` : newTag;
	});
}

/** Toggles a Project step checkbox, keeping its text and block ID. */
export function toggleCheckbox(content: string, ref: LineRef): WriteResult {
	return rewriteLine(content, ref, toggleCheckboxLine);
}

/** Sets (or with null removes) the status token of a Project step, keeping text and block ID. */
export function rewriteStepToken(content: string, ref: LineRef, token: string | null): WriteResult {
	return rewriteLine(content, ref, (line) => {
		const match = line.match(CHECKBOX_AND_TOKEN);
		if (!match) return null;
		const rest = line.slice(match[0].length);
		return `${match[1]}${token ? `${token} ` : ""}${rest}`;
	});
}
