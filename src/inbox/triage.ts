import type { TriageTaskType } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { SyncState } from "../sync/pluginData";

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
	/** 0 (En cours) to 5. */
	priority: number;
}

export interface TriageDeps {
	remote: Pick<Remote, "triage">;
	sync: SyncState;
	save(): Promise<void>;
	/** The note the line goes into and its Project's app id (null = standalone), or why there is none. */
	target(): { path: string; projectId: string | null } | { error: string };
	/** Writes the line at the cursor of that note. */
	insert(line: string): void;
}

export type TriageResult = { ok: true; line: string } | { ok: false; error: string };

/**
 * "Insérer ici": the app turns the item into a Task first (the call most
 * likely to fail), then the Tag task line `#<type> p<n> <title> ^<id>` goes
 * at the cursor and is recorded as last pushed, so the next Push sees no
 * change. The same app item stays: description and comments are kept.
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
			priority: choice.priority,
			project_id: target.projectId,
		});
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	if (response.as === "project") return { ok: false, error: "The app made it a Project, not a Task." };
	const { fields } = response;
	const title = item.title.replace(/\s+/g, " ").trim();
	const line = `#${choice.type} p${choice.priority} ${title} ^${item.id}`;
	deps.insert(line);
	deps.sync.pushedTasks[item.id] = { path: target.path, fields };
	await deps.save();
	return { ok: true, line };
}

type Pos = { line: number; ch: number };

/**
 * Where a new Tag task line goes for a cursor on `cursor`: on that line if
 * blank, else just below it. A blank line is kept before any text that
 * follows, which would otherwise become the Task's (private) body.
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
