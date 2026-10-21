import type { TriageTaskType } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { SyncState } from "../sync/pluginData";
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
	remote: Pick<Remote, "triage">;
	sync: SyncState;
	save(): Promise<void>;
	/**
	 * The note the line goes into, its Project's app id (null = standalone) and whether the
	 * line is a Project step (cursor in a Project note's Tasks section), or why there is none.
	 */
	target(): { path: string; projectId: string | null; step: boolean } | { error: string };
	/** Writes the line (and its body lines) at the cursor of that note. */
	insert(text: string): void;
}

export type TriageResult = { ok: true; line: string } | { ok: false; error: string };

/**
 * "Insérer ici": the app turns the item into a Task first (the call most
 * likely to fail), then the Tag task line `#<type> p<n> <title> ^<id>` (or the
 * Project step `- [ ] #<type> p<n> <title> ^<id>`, no token when inheriting)
 * goes at the cursor with the Description as its body, and is recorded as
 * last pushed, so the next Push sees no change. The same app item stays:
 * description and comments are kept.
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
	const { fields } = response;
	const title = item.title.replace(/\s+/g, " ").trim();
	const tagAndToken = choice.priority === null ? `#${choice.type}` : `#${choice.type} p${choice.priority}`;
	const line = `${target.step ? "- [ ] " : ""}${tagAndToken} ${title} ^${item.id}`;
	const written = [line, ...taskBody(fields.description)];
	deps.insert(written.join("\n"));
	// Recorded as the next Push reads it back from the vault, so it compares equal.
	const description = deindent(readIndentedBody(written, 0).join("\n"));
	deps.sync.pushedTasks[item.id] = { path: target.path, fields: { ...fields, description } };
	await deps.save();
	return { ok: true, line };
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
