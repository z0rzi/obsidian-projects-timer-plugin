import { UPLOADED_IMAGE } from "../comments/commentMarkdown";
import type { TaskStateFields, TriageTaskType } from "../remote/api";
import type { Remote } from "../remote/remote";
import { rewriteOutsideCode } from "../sync/sharedBody";
import { deindent } from "../sync/sharedTask";
import { readIndentedBody } from "../taskParser";

/** Tags "Insérer ici" offers, as the vault writes them. */
export const TRIAGE_TAGS: { type: TriageTaskType; label: string }[] = [
	{ type: "task", label: "#task" },
	{ type: "bug", label: "#bug" },
	{ type: "quick", label: "#quick" },
	{ type: "wait", label: "#wait" },
];

/** Tag the dialog proposes first for an item of the app's `type`. */
export function defaultTag(type: string): TriageTaskType {
	return TRIAGE_TAGS.some((t) => t.type === type) ? (type as TriageTaskType) : "task";
}

export interface TriageChoice {
	type: TriageTaskType;
	/** 0 (En cours) to 5; null = inherit the Project's (Project step only). */
	priority: number | null;
}

export interface TriageDeps {
	remote: Pick<Remote, "triage" | "acknowledge">;
	/**
	 * The note the line goes into, its Project's app id (null = standalone) and whether the
	 * line is a Project step (cursor in a Project note's Tasks section), or why there is none.
	 */
	target(): { path: string; projectId: string | null; step: boolean } | { error: string };
	/** Writes the line (and its body lines) at the cursor of that note. */
	insert(text: string): void;
	/**
	 * Copies an image the Client uploaded (`/uploads/…`) into the vault; returns
	 * its link text for `![[…]]`, or null if it failed.
	 */
	localImage?(url: string): Promise<string | null>;
}

/** `missingImages`: app images left as app links because they couldn't be copied into the vault. */
export type TriageResult = { ok: true; line: string; missingImages: number } | { ok: false; error: string };

/**
 * "Insérer ici": the app turns the item into a Task first (the call most
 * likely to fail), then the Tag task line `#<type> p<n> <title> ^<id>` (or the
 * Project step `- [ ] #<type> p<n> <title> ^<id>`, no token when inheriting)
 * goes at the cursor with the Description as its body, and its base is sent
 * to the app as the vault reads it back, so the next Push sees no change. The
 * same app item stays: description and comments are kept.
 */
export async function runTriage(
	item: { id: string; title: string },
	choice: TriageChoice,
	deps: TriageDeps,
): Promise<TriageResult> {
	const target = deps.target();
	if ("error" in target) return { ok: false, error: target.error };
	let response;
	try {
		response = await deps.remote.triage(item.id, {
			as: "task",
			type: choice.type,
			step: target.step,
			priority: choice.priority,
			project_id: target.projectId,
		});
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	if (response.as === "project") return { ok: false, error: "The app made it a Project, not a Task." };
	const tagAndToken = choice.priority === null ? `#${choice.type}` : `#${choice.type} p${choice.priority}`;
	return writeTask(item, `${target.step ? "- [ ] " : ""}${tagAndToken}`, response.fields, target.path, deps);
}

/**
 * « Insérer ici » on an Unplaced Task: its line, written from the app's fields
 * now (type, status token or done date, title, `^id`) as a Tag task or a
 * Project step after the cursor's place, with its Description as body; then
 * its base is sent. The app isn't otherwise changed: a Project or step the
 * placement changes is offered by the next Push.
 */
export function insertUnplacedTask(
	item: { id: string; fields: TaskStateFields },
	deps: Omit<TriageDeps, "remote"> & { remote: Pick<Remote, "acknowledge"> },
): Promise<TriageResult> {
	const target = deps.target();
	if ("error" in target) return Promise.resolve({ ok: false, error: target.error });
	const { fields } = item;
	const tag = `#${defaultTag(fields.type)}`;
	const date = fields.done_on ? ` ${fields.done_on}` : "";
	let head: string;
	if (fields.status === "termine") head = target.step ? `- [x] ${tag}${date}` : `#done${date}`;
	else {
		const token = fields.status === "a_valider" ? "pr" : fields.status === "en_cours" ? "p0" : fields.priority === null ? "" : `p${fields.priority}`;
		head = `${target.step ? "- [ ] " : ""}${tag}${token ? ` ${token}` : ""}`;
	}
	return writeTask({ id: item.id, title: fields.title }, head, fields, target.path, deps);
}

/**
 * Writes the Task line `<head> <title> ^<id>` with the Description of `fields`
 * as its body at the cursor of `path`, then sends `fields` as its base, with
 * the title and description as the vault reads them back, so the next Push sees no change.
 */
async function writeTask(
	item: { id: string; title: string },
	head: string,
	fields: { description: string },
	path: string,
	deps: Pick<TriageDeps, "insert" | "localImage"> & { remote: Pick<Remote, "acknowledge"> },
): Promise<TriageResult> {
	const title = item.title.replace(/\s+/g, " ").trim();
	const line = `${head} ${title} ^${item.id}`;
	const { text: body, missing } = await withVaultImages(fields.description, deps);
	const written = [line, ...taskBody(body)];
	deps.insert(written.join("\n"));
	// The base as the next Push reads it back from the vault, so it compares equal.
	const description = deindent(readIndentedBody(written, 0).join("\n"));
	try {
		await deps.remote.acknowledge([{ id: item.id, base: { path, fields: { ...fields, title, description } } }]);
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `inserted, but its base was not sent (${error}); the next Push offers its description` };
	}
	return { ok: true, line, missingImages: missing };
}

/**
 * The Description with each app image (`![alt](/uploads/…)`, outside code)
 * copied into the vault and embedded as `![[…]]`, so Obsidian shows it (a
 * later Push uploads it again: the app answers with the same URL). An image
 * that couldn't be copied keeps its app link and is counted in `missing`.
 */
async function withVaultImages(description: string, deps: Pick<TriageDeps, "localImage">): Promise<{ text: string; missing: number }> {
	let missing = 0;
	const copies = new Map<string, Promise<string | null>>();
	const text = await rewriteOutsideCode(description, async (piece) => {
		const parts: string[] = [];
		let last = 0;
		for (const m of piece.matchAll(UPLOADED_IMAGE)) {
			parts.push(piece.slice(last, m.index));
			last = m.index! + m[0].length;
			const url = m[2]!;
			if (!copies.has(url)) copies.set(url, deps.localImage ? deps.localImage(url).catch(() => null) : Promise.resolve(null));
			const link = await copies.get(url)!;
			if (link) {
				parts.push(`![[${link}]]`);
			} else {
				missing++;
				parts.push(m[0]);
			}
		}
		parts.push(piece.slice(last));
		return parts.join("");
	});
	return { text, missing };
}

/** The Description as Task body lines: one tab in, blank lines empty, none at the edges. */
function taskBody(description: string): string[] {
	const text = description.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
	if (!text) return [];
	return text.split(/\r?\n/).map((l) => (l.trim() ? `\t${l}` : ""));
}

type Pos = { line: number; ch: number };

/**
 * Where a new Task line and its body lines (`newLine`, one or more lines) go
 * for a cursor on `cursor`: on that line if blank, else just below it. A
 * blank line is kept before any text that follows, so it stays apart.
 */
export function placeLine(lines: string[], cursor: number, newLine: string): { from: Pos; to: Pos; text: string } {
	const current = lines[cursor] ?? "";
	const blank = !current.trim();
	const next = lines[cursor + 1];
	const tail = next !== undefined && next.trim() ? "\n" : "";
	if (blank) {
		return { from: { line: cursor, ch: 0 }, to: { line: cursor, ch: current.length }, text: newLine + tail };
	}
	const end = { line: cursor, ch: current.length };
	return { from: end, to: end, text: `\n${newLine}${tail}` };
}
