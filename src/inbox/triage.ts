import type { TaskStateFields, TicketUrgency, TriageTaskType } from "../remote/api";
import type { Remote } from "../remote/remote";
import { deindent } from "../sync/sharedTask";
import { priorityToken } from "../lineWriter";
import { readIndentedBody } from "../taskParser";
import { descriptionForVault, type AppDescriptionDeps } from "./appDescription";
import { findTasksHeadingSection } from "../projectCards";

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

/** The Urgency as the Client answered it, and the Priority it suggests at Triage (P0 stays the Developer's choice). */
export const URGENCIES: Record<TicketUrgency, { label: string; priority: number }> = {
	bloquant: { label: "Bloquant", priority: 1 },
	genant: { label: "Gênant", priority: 2 },
	quand_possible: { label: "Quand vous pourrez", priority: 3 },
};

/**
 * Priority the dialog proposes first: the one the Client's Urgency suggests,
 * else p3, or the Project's (null) for a Project step.
 */
export function defaultPriority(step: boolean, urgency: TicketUrgency | null | undefined): number | null {
	if (urgency) return URGENCIES[urgency].priority;
	return step ? null : 3;
}

export interface TriageChoice {
	type: TriageTaskType;
	/** 0 (En cours) to 5; null = inherit the Project's (Project step only). */
	priority: number | null;
}

export interface TriageDeps extends AppDescriptionDeps {
	remote: Pick<Remote, "triage" | "acknowledge">;
	/**
	 * The note the line goes into, its Project's app id (null = standalone) and whether the
	 * line is a Project step (cursor in a Project note's Tasks section), or why there is none.
	 */
	target(): { path: string; projectId: string | null; step: boolean } | { error: string };
	/** Writes the line (and its body lines) at the cursor of that note; throws when it can't. */
	insert(text: string): void | Promise<void>;
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
	if (response.as === "project") return { ok: false, error: "L'app en a fait un Projet, pas une Tâche." };
	const tagAndToken = choice.priority === null ? `#${choice.type}` : `#${choice.type} ${priorityToken(choice.priority)}`;
	return writeTask(item, `${target.step ? "- [ ] " : ""}${tagAndToken}`, response.fields, target.path, deps);
}

/**
 * « Insérer ici » on an Unplaced Task: its line, written from the app's fields
 * now (type, Priority token or done date, title, `^id`) as a Tag task or a
 * Project step after the cursor's place, with its Description as body; then
 * its base is sent, acknowledging the Answer its fields come from, as the
 * Pull does. The app isn't otherwise changed: a Project or step the placement
 * changes is offered by the next Push.
 */
export function insertUnplacedTask(
	item: { id: string; fields: TaskStateFields; answer?: number },
	deps: Omit<TriageDeps, "remote"> & { remote: Pick<Remote, "acknowledge"> },
): Promise<TriageResult> {
	const target = deps.target();
	if ("error" in target) return Promise.resolve({ ok: false, error: target.error });
	const { fields } = item;
	const tag = `#${defaultTag(fields.type)}`;
	const date = fields.done_on ? ` ${fields.done_on}` : "";
	let head: string;
	if (fields.done) head = target.step ? `- [x] ${tag}${date}` : `#done${date}`;
	else {
		const token = fields.priority === null ? "" : ` ${priorityToken(fields.priority)}`;
		head = `${target.step ? "- [ ] " : ""}${tag}${token}`;
	}
	return writeTask({ id: item.id, title: fields.title, answer: item.answer }, head, fields, target.path, deps);
}

/**
 * Writes the Task line `<head> <title> ^<id>` with the Description of `fields`
 * as its body at the cursor of `path`, then sends `fields` as its base, with
 * the title and description as the vault reads them back, so the next Push
 * sees no change, and acknowledges the Answer `item.answer`, if any.
 */
async function writeTask(
	item: { id: string; title: string; answer?: number },
	head: string,
	fields: { description: string },
	path: string,
	deps: Pick<TriageDeps, "insert" | "localImage" | "appUrl"> & { remote: Pick<Remote, "acknowledge"> },
): Promise<TriageResult> {
	const title = item.title.replace(/\s+/g, " ").trim();
	const line = `${head} ${title} ^${item.id}`;
	const { text: body, missing } = await descriptionForVault(fields.description, deps);
	const written = [line, ...taskBody(body)];
	try {
		await deps.insert(written.join("\n"));
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `triée dans l'app, mais pas écrite (${error}) : le prochain Pull la proposera à insérer` };
	}
	// The base as the next Push reads it back from the vault, so it compares equal.
	const description = deindent(readIndentedBody(written, 0).join("\n"));
	try {
		const answer = item.answer !== undefined ? { answer: item.answer } : {};
		await deps.remote.acknowledge([{ id: item.id, base: { path, fields: { ...fields, title, description } }, ...answer }]);
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `insérée, mais sa base n'a pas été envoyée (${error}) : le prochain Push proposera sa description` };
	}
	return { ok: true, line, missingImages: missing };
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

/**
 * « Insérer dans <Projet> »'s target: a step of the Project note whose `lines` will be
 * edited, or why not when they have no Tasks heading (checked before the app is called).
 */
export function firstStepTarget(lines: string[], project: { id: string; path: string; title: string }): ReturnType<TriageDeps["target"]> {
	if (!findTasksHeadingSection(lines)) return { error: `${project.title} n'a pas de titre « Tasks » : ajoutez-le, puis réessayez.` };
	return { path: project.path, projectId: project.id, step: true };
}

/**
 * Where « Insérer dans <Projet> » writes a step (`newLine` and its body lines)
 * as the first of the Project note's Tasks section: before its first non-blank
 * line (a blank line right under the heading is kept), on its blank line when
 * the section holds nothing, after the heading when it ends the note. `line`
 * is where the step's line lands. Null without a Tasks heading.
 */
export function placeFirstStep(lines: string[], newLine: string): { from: Pos; to: Pos; text: string; line: number } | null {
	const section = findTasksHeadingSection(lines);
	if (!section) return null;
	const { start, end } = section;
	if (start >= lines.length) {
		const at = { line: start - 1, ch: lines[start - 1]!.length };
		return { from: at, to: at, text: `\n${newLine}`, line: start };
	}
	const first = lines.slice(start, end).findIndex((l) => l.trim());
	if (first === -1 && start < end) {
		return { from: { line: start, ch: 0 }, to: { line: start, ch: lines[start]!.length }, text: newLine, line: start };
	}
	const at = { line: first === -1 ? start : start + first, ch: 0 };
	return { from: at, to: at, text: `${newLine}\n`, line: at.line };
}
