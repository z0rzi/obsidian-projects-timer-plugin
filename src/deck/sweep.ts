import { splitBlockId } from "../blockId";
import { localDay } from "../localDate";
import { noteDate } from "../noteDate";
import type { ItemState, Priority, PushedTaskType } from "../remote/api";
import { readTagTasks } from "../sync/sharedTask";
import { indentedBodyEnd } from "../taskParser";

/**
 * The Sweep (spec « Plugin: Triage, Deck and Sweep »): the first Deck session
 * of the day starts with the Tag tasks of Daily notes older than the sweep
 * age, each sent to the Frigo, moved into a Project note or kept for another
 * sweep age. Pure: the notes and the app's state come in.
 */

/** A note of the vault, as the Sweep reads it. */
export interface SweepNote {
	path: string;
	/** The file name without `.md`. */
	basename: string;
	content: string;
	/** Creation time (ms), the note's date when its name has none. */
	ctime: number;
}

export interface SweepOptions {
	/** The Daily Notes folder, "" for the vault's root. */
	folder: string;
	/** The Daily Notes `moment` format of a note's name. */
	format: string;
	/** The sweep age in days: a note older than that is swept. */
	age: number;
	/** A Project note, never swept. */
	isProject(path: string): boolean;
}

/** A Tag task the Sweep offers: its line and what the Deck shows of it. */
export interface SweepCandidate {
	/** Its app id, the line's `^id`; null for a line not Pushed yet (the closing Push creates it, no keep). */
	id: string | null;
	path: string;
	line: number;
	raw: string;
	title: string;
	type: PushedTaskType;
	priority: Priority;
	description: string;
	/** The note's date, `YYYY-MM-DD`. */
	day: string;
}

/** `day` (`YYYY-MM-DD`) moved by `days`. */
export function addDays(day: string, days: number): string {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/**
 * A note the Daily Notes plugin would have made: in its folder, as deep as
 * its format puts notes (directly in it for `YYYY-MM-DD`).
 */
function inDailyFolder(path: string, options: SweepOptions): boolean {
	const prefix = options.folder ? `${options.folder}/` : "";
	if (!path.startsWith(prefix)) return false;
	const depth = (s: string) => s.split("/").length - 1;
	return depth(path.slice(prefix.length)) === depth(options.format);
}

/**
 * The Sweep's candidates on `today` (`YYYY-MM-DD`): Tag tasks (not steps) in
 * notes of the Daily Notes folder, never a Project note, whose note date is
 * older than the sweep age; open, not at PZ, P0 or P1 (`#quick` lines
 * included); a line with an `^id` held open by the app (not archived) and not
 * kept until a day after today, or a line not Pushed yet (no `^id`). Oldest
 * note first, then in line order.
 */
export function sweepCandidates(notes: SweepNote[], state: ItemState[], options: SweepOptions, today: string): SweepCandidate[] {
	const tasks = new Map(state.flatMap((i) => (i.kind === "task" && !i.archived ? [[i.id, i] as const] : [])));
	const before = addDays(today, -options.age);
	const format = options.format.slice(options.format.lastIndexOf("/") + 1);
	const out: SweepCandidate[] = [];
	for (const note of notes) {
		if (!inDailyFolder(note.path, options) || options.isProject(note.path)) continue;
		const day = noteDate({ basename: note.basename, stat: { ctime: note.ctime } }, format);
		if (day >= before) continue;
		for (const t of readTagTasks(note.path, note.content, null)) {
			if (t.done || t.type === null || t.priority === null) continue;
			if (t.priority === "pz" || t.priority === 0 || t.priority === 1) continue;
			if (t.blockId) {
				const app = tasks.get(t.blockId);
				if (!app || (app.kept_until !== null && app.kept_until > today)) continue;
			}
			out.push({ id: t.blockId ?? null, path: t.path, line: t.line, raw: t.raw, title: t.title, type: t.type, priority: t.priority, description: t.description, day });
		}
	}
	return out.sort((a, b) => a.day.localeCompare(b.day) || a.path.localeCompare(b.path) || a.line - b.line);
}

/**
 * The Deck session at `now` is the day's first, the one that sweeps: the
 * Deck's latest write (`StateResponse.deck_at`: a Triage, an archive, a keep)
 * is not from today (local day), or there is none. Read from the app, never
 * from plugin data (ADR 0006).
 */
export function firstSessionToday(deckAt: string | null, now: Date): boolean {
	return deckAt === null || localDay(new Date(deckAt)) !== localDay(now);
}

/** The Sweep's failures as the Deck's report words them (spec: French UI). */
export const SWEEP_ERRORS = {
	missing: "ligne introuvable dans la note",
	changed: "ligne modifiée dans la note",
	notPushed: "ligne pas encore poussée vers l'app",
} as const;

/** What finds a Sweep line in its note: its `^id`, else its text where it was read. */
export type SweepLineRef = Pick<SweepCandidate, "id" | "line" | "raw">;

/**
 * The index of `task`'s line in `lines`: the only one ending with its `^id`, a Tag task; a line not Pushed yet
 * where it was read, else its only exact copy (an earlier move shifted it). -1 when there is none or more than one.
 */
export function sweepLineIndex(lines: string[], task: SweepLineRef): number {
	const hits =
		task.id !== null
			? lines.flatMap((l, i) => (splitBlockId(l).blockId === task.id && /^#\S/.test(l) ? [i] : []))
			: lines[task.line] === task.raw
				? [task.line]
				: lines.flatMap((l, i) => (l === task.raw ? [i] : []));
	return hits.length === 1 ? hits[0]! : -1;
}

/**
 * A Sweep line in its note, as the focused row of the Sweep list shows it: the nearest heading above, up to
 * three non-empty lines before (not past that heading) and after, and the line with its body.
 */
export interface SweepLineContext {
	heading: string | null;
	before: string[];
	line: string[];
	after: string[];
}

/** How many lines the context shows on each side of a Sweep line. */
const CONTEXT_LINES = 3;
const HEADING = /^#{1,6}\s/;

/** `task`'s line in the note `content`, with its context; null when the line is no longer in the note. */
export function lineContext(content: string, task: SweepLineRef): SweepLineContext | null {
	const lines = content.split("\n");
	const at = sweepLineIndex(lines, task);
	if (at < 0) return null;
	let headingAt = -1;
	for (let i = at - 1; i >= 0; i--) {
		if (HEADING.test(lines[i]!)) {
			headingAt = i;
			break;
		}
	}
	const filled = (l: string) => l.trim() !== "";
	const end = indentedBodyEnd(lines, at);
	return {
		heading: headingAt < 0 ? null : lines[headingAt]!,
		before: lines.slice(headingAt + 1, at).filter(filled).slice(-CONTEXT_LINES),
		line: lines.slice(at, end + 1),
		after: lines.slice(end + 1).filter(filled).slice(0, CONTEXT_LINES),
	};
}
