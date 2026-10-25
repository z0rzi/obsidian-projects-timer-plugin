import { splitBlockId } from "./blockId";
import { DAY_SOURCE, readTypeTag, STATUS_TOKEN_SOURCE, TYPE_TAG_SOURCE } from "./taskParser";

/** What the kanban knew about a line when it was loaded; with a block ID, the line is found by it alone. */
export type LineRef = { line: number; raw: string; blockId?: string };

export const LineRef = {
	/** The line ending with `^<blockId>`, wherever it is in the file. */
	byId: (blockId: string): LineRef => ({ line: -1, raw: "", blockId }),
};

/** A Task line's status token: `p0` (En cours) to `p5`, or `pr` (À valider). */
export type StatusToken = "p0" | "p1" | "p2" | "p3" | "p4" | "p5" | "pr";

/** The token of a Priority: `pr` for PR, else `p<n>` (0–5). */
export const priorityToken = (priority: number | "pr"): StatusToken => (priority === "pr" ? "pr" : (`p${priority}` as StatusToken));

export type WriteResult =
	| { ok: true; content: string }
	| { ok: false; reason: "not-found" | "ambiguous" | "changed" };

type Refused = Extract<WriteResult, { ok: false }>;

/** Atomic edit of one file (Obsidian's `vault.process`, or a memory map in tests). */
export type ProcessFile = (path: string, edit: (content: string) => string) => Promise<void>;

/**
 * Rewrites one line of `path` inside an atomic file edit. A refused rewrite
 * (line gone, ambiguous, changed) leaves the file as is and is returned.
 */
export async function processLine(
	process: ProcessFile,
	path: string,
	rewrite: (content: string) => WriteResult,
): Promise<{ ok: true; changed: boolean } | Refused> {
	let outcome: { ok: true; changed: boolean } | Refused = { ok: true, changed: false };
	await process(path, (content) => {
		const result = rewrite(content);
		if (!result.ok) {
			outcome = result;
			return content;
		}
		outcome = { ok: true, changed: result.content !== content };
		return result.content;
	});
	return outcome;
}

/** `processLine` for the line `^id`; throws `^<id> is not in the file` (or ambiguous, changed). */
export async function processLineById(
	process: ProcessFile,
	path: string,
	id: string,
	rewrite: (content: string, ref: LineRef) => WriteResult,
): Promise<void> {
	const ref = LineRef.byId(id);
	const result = await processLine(process, path, (content) => rewrite(content, ref));
	if (!result.ok) throw new Error(`^${id} is ${result.reason === "not-found" ? "not in the file" : result.reason}`);
}

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
/** Checkbox and type tag of a Project step (group 1, kept), then its token (dropped). */
const CHECKBOX_AND_TOKEN = new RegExp(
	`^(- \\[[ xX]\\] (?:${TYPE_TAG_SOURCE} )?)(?:(?:${STATUS_TOKEN_SOURCE})(?: |$))?`,
);

/** Checkbox of a Project step, its type tag (group 1, kept), then its token and done date (dropped). */
const STEP_HEAD = new RegExp(
	`^- \\[[ xX]\\] ((?:${TYPE_TAG_SOURCE} )?)(?:(?:${STATUS_TOKEN_SOURCE})(?: |$))?(?:${DAY_SOURCE}(?: |$))?`,
);

/** Checkbox of a Project step. */
const CHECKBOX = /^- \[[ xX]\] /;

/**
 * The step line with its type tag moved right after the checkbox, where the
 * head regexes above look for it; unchanged without tag or checkbox.
 */
function withTypeTagFirst(line: string): string {
	const checkbox = line.match(CHECKBOX)?.[0];
	if (!checkbox) return line;
	const text = line.slice(checkbox.length);
	const { type, rest } = readTypeTag(text);
	if (rest === text) return line;
	return rest ? `${checkbox}#${type} ${rest}` : `${checkbox}#${type}`;
}

/** Replaces the tag (and priority token) of a Tag task line, keeping title and block ID. */
export function rewriteTaskTag(content: string, ref: LineRef, newTag: string): WriteResult {
	return rewriteLine(content, ref, (line) => {
		if (!line.startsWith("#")) return null;
		const rest = line.replace(TAG_AND_TOKEN, "");
		return rest ? `${newTag} ${rest}` : newTag;
	});
}

/** Sets (or with null removes) the status token of a Project step, keeping its type tag, text and block ID. */
export function rewriteStepToken(content: string, ref: LineRef, token: StatusToken | null): WriteResult {
	return rewriteLine(content, ref, (line) => withStepToken(line, token));
}

/** The step line with `token` (none if null) after its checkbox and type tag; null if not a checkbox line. */
function withStepToken(line: string, token: StatusToken | null): string | null {
	const step = withTypeTagFirst(line);
	const match = step.match(CHECKBOX_AND_TOKEN);
	if (!match) return null;
	return `${match[1]}${token ? `${token} ` : ""}${step.slice(match[0].length)}`;
}

/**
 * Ticks a Project step done on `date` (its token removed, the date after its
 * type tag, or after the checkbox without one), or with null unticks it and
 * removes the date. Type tag, text and block ID are kept.
 */
export function setStepDone(content: string, ref: LineRef, date: string | null): WriteResult {
	return rewriteLine(content, ref, (line) => {
		const step = withTypeTagFirst(line);
		const match = step.match(STEP_HEAD);
		if (!match) return null;
		const rest = step.slice(match[0].length);
		return date ? `- [x] ${match[1]}${date} ${rest}` : `- [ ] ${match[1]}${rest}`;
	});
}

/** Marks a Task line done on `date`: a Project step ticked with the date, a Tag task `#done <date>`. */
export function markDone(content: string, ref: LineRef, step: boolean, date: string): WriteResult {
	return step ? setStepDone(content, ref, date) : rewriteTaskTag(content, ref, `#done ${date}`);
}

/**
 * Sets the status token of a Task line found by `ref`, whatever its kind: after
 * the tag of a Tag task (`#task p3 x` → `#task p1 x`), after the checkbox of a
 * Project step and its type tag (adding one to an inheriting step makes it an
 * Override); null removes it from a step. Title and block ID are kept.
 */
export function setTaskToken(content: string, ref: LineRef, token: StatusToken | null): WriteResult {
	return rewriteLine(content, ref, (line) => {
		const step = withStepToken(line, token);
		if (step !== null) return step;
		const tag = line.match(/^#\S+/)?.[0];
		if (!tag || token === null) return null;
		const rest = line.replace(TAG_AND_TOKEN, "");
		return rest ? `${tag} ${token} ${rest}` : `${tag} ${token}`;
	});
}

/**
 * Ends a line not yet pushed with the block ID the plugin generated for it. The line is
 * found by its content: where it was read, else its only exact copy in the
 * file (lines may have moved while the Push modal was open).
 */
export function appendBlockId(content: string, ref: Omit<LineRef, "blockId">, id: string): WriteResult {
	const lines = content.split("\n");
	let index = lines[ref.line] === ref.raw ? ref.line : -1;
	if (index < 0) {
		const hits = lines.flatMap((line, i) => (line === ref.raw ? [i] : []));
		if (hits.length !== 1) return { ok: false, reason: hits.length ? "ambiguous" : "not-found" };
		index = hits[0]!;
	}
	const line = lines[index]!;
	if (splitBlockId(line).blockId) return { ok: false, reason: "changed" };
	lines[index] = `${line.trimEnd()} ^${id}`;
	return { ok: true, content: lines.join("\n") };
}
