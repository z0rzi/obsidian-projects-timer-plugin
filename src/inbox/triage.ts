import type { TaskStateFields, TriagePriority, TriageTaskType } from "../remote/api";
import { RemoteError, type Remote } from "../remote/remote";
import { deindent, readTagTasks } from "../sync/sharedTask";
import { lineToken } from "../lineWriter";
import { appendToSection } from "../noteSections";
import { readIndentedBody } from "../taskParser";
import { descriptionForVault, type AppDescriptionDeps } from "./appDescription";
import { noteProject, projectOfLink, type ProjectRules } from "../sync/projectLink";

/** Tags « Insérer ici » writes, as the vault writes them. */
export const TRIAGE_TAGS: { type: TriageTaskType; label: string }[] = [
	{ type: "task", label: "#task" },
	{ type: "bug", label: "#bug" },
	{ type: "quick", label: "#quick" },
	{ type: "wait", label: "#wait" },
	{ type: "idea", label: "#idea" },
];

/** Tag an Unplaced Task of the app's `type` is written with. */
export function defaultTag(type: string): TriageTaskType {
	return TRIAGE_TAGS.some((t) => t.type === type) ? (type as TriageTaskType) : "task";
}

export interface TriageChoice {
	type: TriageTaskType;
	/** 0 (En ce moment) to 5, `pz` (the Frigo), or `pq` (Rapide, a `quick` only). */
	priority: TriagePriority;
	/** The Project note the Task belongs to (`id` null: not pushed yet), linked as its body's first line; null for none. */
	project: { path: string; id: string | null } | null;
	/** The Zone's id, null for none; absent: the one the Client suggested stays. */
	zone?: number | null;
}

export interface TriageDeps extends AppDescriptionDeps {
	remote: Pick<Remote, "triage" | "acknowledge">;
	/** Path of today's Daily note, where the line goes. */
	dailyNote: string;
	/** The heading (`## Triage`) whose section the line ends. */
	heading: string;
	/** What a missing Daily note starts from: the plugin's template, "" for none. */
	template(): Promise<string>;
	/** Writes `edit` of the note at `path` (null: missing, it is created); returns the text written. */
	write(path: string, edit: (content: string | null) => string): Promise<string>;
	/** The link text Obsidian writes for note `path` from `sourcePath`: its name when unique, else its path. */
	linkText(path: string, sourcePath: string): string;
	/** How the Push resolves Project links, to read the line back as it will. */
	projects: ProjectRules;
}

/** Where a cursor insert (« Insérer ici » on an Unplaced Task) goes: the note, and whether it is a Project step. */
export interface CursorDeps extends AppDescriptionDeps {
	remote: Pick<Remote, "acknowledge">;
	/** The note the line goes into and whether the line is a Project step (cursor in a Project note's Tasks section), or why there is none. */
	target(): { path: string; step: boolean } | { error: string };
	/** Writes the line (and its body lines) at the cursor of that note; throws when it can't. */
	insert(text: string): void | Promise<void>;
}

/**
 * `missingImages`: app images left as app links because they couldn't be copied into the vault. `path`: the note
 * written. `stale`: the app no longer has the item À trier as shown (409 or 404: withdrawn, edited or triaged meanwhile),
 * nothing written.
 * `triaged`: the app did triage it, the note or the base failed after.
 */
export type TriageResult =
	| { ok: true; line: string; path: string; missingImages: number }
	| { ok: false; error: string; stale?: true; triaged?: true };

/** The app's answer for an item that is no longer À trier as shown: 409 (Triaged or edited meanwhile) or 404 (withdrawn: archived). */
export function notToTriage(e: unknown): boolean {
	return e instanceof RemoteError && (e.status === 409 || e.status === 404);
}

/**
 * Triage: the app turns the item into a Task first (the call most likely to
 * fail), then the Tag task line `#<type> p<n> <title> ^<id>` (no token for a
 * Rapide) goes at the end of the `deps.heading` section of today's Daily
 * note, with the Project's link as its body's first line and the Description
 * below. Its base is sent to the app as the Push reads the note back, so the
 * next Push sees no change. The same app item stays: description and comments
 * are kept.
 */
export async function runTriage(
	item: { id: string; title: string; changed_at?: string },
	choice: TriageChoice,
	deps: TriageDeps,
): Promise<TriageResult> {
	let response;
	try {
		response = await deps.remote.triage(item.id, {
			as: "task",
			type: choice.type,
			priority: choice.priority,
			project_id: choice.project?.id ?? null,
			...(choice.zone !== undefined ? { zone_id: choice.zone } : {}),
			// The Ticket as shown: the app answers 409 when its author edited it since.
			...(item.changed_at !== undefined ? { expected: item.changed_at } : {}),
		});
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e), ...(notToTriage(e) ? { stale: true as const } : {}) };
	}
	const path = deps.dailyNote;
	const token = lineToken(choice.priority);
	const line = `${token === null ? `#${choice.type}` : `#${choice.type} ${token}`} ${oneLine(item.title)} ^${item.id}`;
	const { text: description, missing } = await descriptionForVault(response.fields.description, deps);
	const link = choice.project ? [`\t[[${deps.linkText(choice.project.path, path)}]]`] : [];
	const written = [line, ...link, ...taskBody(description)].join("\n");
	let content: string;
	try {
		const template = await deps.template();
		content = await deps.write(path, (now) => appendToSection(now ?? fillTemplate(template, path), deps.heading, written));
	} catch (e) {
		return { ok: false, error: notWritten(e), triaged: true };
	}
	// The base as the next Push reads it back from the vault, so it compares equal.
	const read = readTagTasks(path, content, noteProject(deps.projects, path, content), projectOfLink(deps.projects, path)).find(
		(t) => t.blockId === item.id,
	);
	const fields = { ...response.fields, title: read?.title ?? oneLine(item.title), description: read?.description ?? "" };
	const sent = await sendBase({ id: item.id }, { path, fields }, line, missing, deps);
	return sent.ok ? sent : { ...sent, triaged: true };
}

/** The title on one line, as a Task line holds it. */
function oneLine(title: string): string {
	return title.replace(/\s+/g, " ").trim();
}

function notWritten(e: unknown): string {
	const error = e instanceof Error ? e.message : String(e);
	return `triée dans l'app, mais pas écrite (${error}) : le prochain Pull la proposera à insérer`;
}

/** Sends the base of a line just written, acknowledging the Answer `item.answer`, if any. */
async function sendBase(
	item: { id: string; answer?: number },
	base: { path: string; fields: object },
	line: string,
	missingImages: number,
	deps: { remote: Pick<Remote, "acknowledge"> },
): Promise<TriageResult> {
	try {
		const answer = item.answer !== undefined ? { answer: item.answer } : {};
		await deps.remote.acknowledge([{ id: item.id, base, ...answer }]);
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `insérée, mais sa base n'a pas été envoyée (${error}) : le prochain Push proposera sa description` };
	}
	return { ok: true, line, path: base.path, missingImages };
}

/** A new Daily note's text from the template: `{{title}}` and `{{date}}` are the note's name, as the core Daily notes fill them. */
function fillTemplate(template: string, path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
	return template.replace(/\{\{\s*(title|date)\s*\}\}/g, name);
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
	deps: CursorDeps,
): Promise<TriageResult> {
	const target = deps.target();
	if ("error" in target) return Promise.resolve({ ok: false, error: target.error });
	const { fields } = item;
	const tag = `#${defaultTag(fields.type)}`;
	const date = fields.done_on ? ` ${fields.done_on}` : "";
	let head: string;
	if (fields.done) head = target.step ? `- [x] ${tag}${date}` : `#done${date}`;
	else {
		const token = fields.priority === null ? null : lineToken(fields.priority);
		head = `${target.step ? "- [ ] " : ""}${tag}${token === null ? "" : ` ${token}`}`;
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
	deps: CursorDeps,
): Promise<TriageResult> {
	const title = oneLine(item.title);
	const line = `${head} ${title} ^${item.id}`;
	const { text: body, missing } = await descriptionForVault(fields.description, deps);
	const written = [line, ...taskBody(body)];
	try {
		await deps.insert(written.join("\n"));
	} catch (e) {
		return { ok: false, error: notWritten(e) };
	}
	// The base as the next Push reads it back from the vault, so it compares equal.
	const description = deindent(readIndentedBody(written, 0).join("\n"));
	return sendBase(item, { path, fields: { ...fields, title, description } }, line, missing, deps);
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
