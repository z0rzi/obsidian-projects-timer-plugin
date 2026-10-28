import { decisionCount, DONE_KIND, type DeckDecision, type DeckItem, type DeckState } from "../deck/deckSession";
import { SWEEP_OUTCOMES } from "../deck/deckEnd";
import type { PushReport } from "../deck/pushReport";
import type { SweepLineContext } from "../deck/sweep";
import { sweepCount } from "../deck/sweepSession";
import type { PushedTaskType } from "../remote/api";
import { priorityKey, priorityLabel, TICKET_ACTIONS } from "./deckRender";
import { DONE_WORDS, type DotMark } from "./deckStripRender";

/**
 * What the Deck's lists show, pure (no DOM, no Obsidian): the Sweep list (its lines by note, age, decision and
 * the focused line in its note), the end screen and the report it becomes once the session writes (the closing
 * Push's result worded by `deck/pushReport.ts`). `deckListDraw.ts` draws them.
 */

/** A Priority on a list: `data-priority` and its label. */
export interface PriorityChip {
	key: string;
	label: string;
}

/** A Sweep line's age bar is full at that many days. */
export const FULL_AGE_DAYS = 30;

/** A row of the Sweep list. */
export interface SweepRow {
	index: number;
	title: string;
	type: PushedTaskType;
	tag: string;
	priority: PriorityChip;
	/** « 27 j ». */
	age: string;
	/** The age bar's width, 0 to 1 (full at `FULL_AGE_DAYS`). */
	ageFraction: number;
	/** The decision recorded, in words, with its progress-strip mark (its colour); null before one. */
	decision: { label: string; mark: DotMark } | null;
	/** No app id: Enter can't keep it. */
	notPushed: boolean;
	focused: boolean;
	/** The focused line in its note once read, « missing » when it is no longer there; undefined otherwise. */
	context?: SweepLineContext | "missing";
}

/** The Sweep list: its lines grouped by note, oldest note first, then « Continuer ». */
export interface SweepList {
	groups: { path: string; header: string; rows: SweepRow[] }[];
	continueRow: { label: string; focused: boolean };
}

/** Days from `day` to `today`, both `YYYY-MM-DD`. */
function daysBetween(day: string, today: string): number {
	return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}

/** A daily note's header: « 2026-10-01 · Point JMJ », its date and its file name without the date. */
function noteHeader(path: string, day: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
	const title = name.replace(/^\d{4}-\d{2}-\d{2}[\s_·–-]*/, "").trim();
	return title ? `${day} · ${title}` : day;
}

/** The project a move goes to, by its title. */
function projectTitle(state: DeckState, path: string): string {
	return state.context.projects.find((p) => p.path === path)?.title ?? path;
}

/** A Sweep line's recorded decision in words (« frigo », « gardée », « déplacée → Widget ») and mark. */
function sweepDecision(state: DeckState, decision: DeckDecision | null): SweepRow["decision"] {
	if (decision?.kind !== "frigo" && decision?.kind !== "keep" && decision?.kind !== "move") return null;
	const mark = DONE_KIND[decision.kind];
	if (decision.kind === "frigo") return { label: "frigo", mark };
	const label = DONE_WORDS[mark].one;
	return { label: decision.kind === "move" ? `${label} → ${projectTitle(state, decision.project.path)}` : label, mark };
}

/** The Sweep list of `state` on `today` (`YYYY-MM-DD`), its lines in the session's order (oldest note first). */
export function sweepList(state: DeckState, today: string): SweepList {
	const count = sweepCount(state);
	const groups: SweepList["groups"] = [];
	state.items.slice(0, count).forEach((item, index) => {
		const { task } = item as Extract<DeckItem, { kind: "sweep" }>;
		let group = groups.at(-1);
		if (group?.path !== task.path) {
			group = { path: task.path, header: noteHeader(task.path, task.day), rows: [] };
			groups.push(group);
		}
		const days = Math.max(0, daysBetween(task.day, today));
		const focused = state.sweeping && state.index === index;
		const read = state.sweepLines[index];
		group.rows.push({
			index,
			title: task.title,
			type: task.type,
			tag: `#${task.type}`,
			priority: { key: priorityKey(task.priority), label: priorityLabel(task.priority) },
			age: `${days} j`,
			ageFraction: Math.min(1, days / FULL_AGE_DAYS),
			decision: sweepDecision(state, state.decisions[index] ?? null),
			notPushed: task.id === null,
			focused,
			...(focused && read !== undefined ? { context: read ?? "missing" } : {}),
		});
	});
	const tickets = state.items.length - count;
	return {
		groups,
		continueRow: { label: tickets > 0 ? `→ Continuer vers les tickets (${tickets})` : "→ Fin", focused: state.sweeping && state.index === count },
	};
}

/** Where a row stands while the session writes and on the report; null before. */
export type RowStatus = { tone: "sending" | "done" | "info" | "error"; text: string } | null;

/** A Ticket on the end screen. */
export interface EndTicketRow {
	index: number;
	title: string;
	/** The type it is written with; null when it is not written. */
	type: string | null;
	priority: PriorityChip | null;
	/** What will happen: « ✎ écrire · Widget », « 🗄 archiver « déjà fait » », « ⏭ passer ». */
	action: string;
	status: RowStatus;
	focused: boolean;
}

/** The Sweep's lines with one outcome on the end screen: « au frigo (2) » and their titles. */
export interface EndSweepGroup {
	label: string;
	mark: DotMark;
	lines: { index: number; title: string; detail: string | null; status: RowStatus }[];
	focused: boolean;
}

/** The end screen, the report once the session writes. */
export interface EndScreen {
	tickets: EndTicketRow[];
	sweep: EndSweepGroup[];
	/** « Tout écrire (n) », null once the session writes. */
	write: { label: string; focused: boolean } | null;
	/** The closing Push's result on the report. */
	push: PushReport | null;
	/** Every card written: the report's buttons (« Fermer »). */
	finished: boolean;
	/** « Réessayer les échecs »: the report has failed cards. */
	retry: boolean;
}

function rowStatus(state: DeckState, index: number): RowStatus {
	const result = state.results[index];
	if (!result) return state.phase === "committing" ? { tone: "sending", text: "Envoi…" } : null;
	if (result.kind === "failed") return { tone: "error", text: `✕ ${result.error}` };
	if (result.kind === "stale") return { tone: "info", text: "ⓘ plus à trier : retirée ou modifiée" };
	return { tone: "done", text: `✓ ${DONE_WORDS[result.kind].one}` };
}

/** The end screen of `state`: its rows in `endTargets`'s order, then « Tout écrire » (focused by default). */
export function endScreen(state: DeckState): EndScreen {
	const deciding = state.phase === "deciding";
	let row = 0;
	const focused = () => deciding && state.endRow === row++;
	const tickets = state.items.flatMap((item, index): EndTicketRow[] => {
		const decision = state.decisions[index];
		if (item.kind !== "ticket" || !decision) return [];
		const status = rowStatus(state, index);
		const base = { index, title: item.ticket.title, status, focused: focused() };
		if (decision.kind === "write") {
			const { type, priority, project } = decision.choice;
			const write = `${TICKET_ACTIONS.write.icon} ${TICKET_ACTIONS.write.word}`;
			const action = project ? `${write} · ${projectTitle(state, project.path)}` : write;
			return [{ ...base, type, priority: { key: priorityKey(priority), label: priorityLabel(priority) }, action }];
		}
		const { icon, word } = TICKET_ACTIONS[decision.kind === "archive" ? "archive" : "skip"];
		const action = decision.kind === "archive" && decision.comment ? `${icon} ${word} « ${decision.comment} »` : `${icon} ${word}`;
		return [{ ...base, type: null, priority: null, action }];
	});
	const sweep = SWEEP_OUTCOMES.flatMap((kind): EndSweepGroup[] => {
		const lines = state.items.flatMap((item, index) => {
			const decision = state.decisions[index];
			if (item.kind !== "sweep" || decision?.kind !== kind) return [];
			const detail = decision.kind === "move" ? `→ ${projectTitle(state, decision.project.path)}` : null;
			return [{ index, title: item.task.title, detail, status: rowStatus(state, index) }];
		});
		if (lines.length === 0) return [];
		// The groups are named as the design does: « gardées (1) ».
		const mark = DONE_KIND[kind];
		return [{ label: `${DONE_WORDS[mark].many} (${lines.length})`, mark, lines, focused: focused() }];
	});
	return {
		tickets,
		sweep,
		write: deciding ? { label: `Tout écrire (${decisionCount(state)})`, focused: state.endRow === null } : null,
		push: state.phase === "done" ? state.pushed : null,
		finished: state.phase === "done",
		retry: state.phase === "done" && state.results.some((r) => r?.kind === "failed"),
	};
}
