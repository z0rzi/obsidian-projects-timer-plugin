import { DONE_KIND, furthestReached, deckScreen, type DeckDecision, type DeckItem, type DeckState, type DoneKind } from "../deck/deckSession";
import { sweepCount } from "../deck/sweepSession";
import { priorityKey } from "./deckRender";

/**
 * The Deck's progress strip, pure (no DOM, no Obsidian): a dot per card coloured by its decision, where the
 * session is, its tally; the words of what was decided or done, shared with the lists. `deckDraw.ts` draws it.
 */

export function itemTitle(item: DeckItem): string {
	return item.kind === "ticket" ? item.ticket.title : item.task.title;
}

/**
 * What a card's dot on the progress strip shows of its recorded decision (`data-mark`): none yet, written (in its
 * Priority's colour), to the Frigo (a Ticket written `pz` too), archived, skipped, kept, moved.
 */
export type DotMark = "none" | DoneKind;

/** A card on the progress strip: `index` its place in the session (`items.length` for the end). */
export interface StripDot {
	index: number;
	title: string;
	mark: DotMark;
	/** The Priority a written card got (`priorityKey`), null for any other mark. */
	priority: string | null;
	current: boolean;
	/** Reached already: a click goes there. */
	reached: boolean;
}

/** The progress strip: its dots by step (the Sweep's lines, the Tickets, the end), where the session is, its tally. */
export interface ProgressStrip {
	groups: { kind: "sweep" | "ticket" | "end"; dots: StripDot[] }[];
	/** « Balayage 3 / 12 », « Ticket 2 / 5 », « Fin ». */
	position: string;
	/** « 2 écrites · 1 au frigo · 1 passée », empty before any decision. */
	tally: string;
}

function dotMark(decision: DeckDecision | null): Pick<StripDot, "mark" | "priority"> {
	if (!decision) return { mark: "none", priority: null };
	if (decision.kind === "write") {
		const { priority } = decision.choice;
		return priority === "pz" ? { mark: "frigo", priority: null } : { mark: "written", priority: priorityKey(priority) };
	}
	return { mark: DONE_KIND[decision.kind], priority: null };
}

/** What was decided or done, in words, one and many: the tally (in this order), the report, the end screen's Sweep groups. */
export const DONE_WORDS: Record<DoneKind, { one: string; many: string }> = {
	written: { one: "écrite", many: "écrites" },
	frigo: { one: "au frigo", many: "au frigo" },
	archived: { one: "archivée", many: "archivées" },
	skipped: { one: "passée", many: "passées" },
	kept: { one: "gardée", many: "gardées" },
	moved: { one: "déplacée", many: "déplacées" },
};

/** The progress strip of a session, null when it has no card (nothing to triage). */
export function progressStrip(state: DeckState): ProgressStrip | null {
	if (state.items.length === 0) return null;
	const reached = furthestReached(state);
	const swept = sweepCount(state);
	// On the Sweep list's « Continuer » row no card is current; every Sweep line is always within reach.
	const dot = (index: number, title: string, decision: DeckDecision | null): StripDot => ({
		index,
		title,
		...dotMark(decision),
		current: index === state.index && !(state.sweeping && index >= swept),
		reached: index <= reached || index < swept,
	});
	const dots = state.items.map((item, i) => ({ kind: item.kind, dot: dot(i, itemTitle(item), state.decisions[i] ?? null) }));
	const groups: ProgressStrip["groups"] = (["sweep", "ticket"] as const)
		.map((kind) => ({ kind, dots: dots.filter((d) => d.kind === kind).map((d) => d.dot) }))
		.filter((g) => g.dots.length > 0);
	groups.push({ kind: "end", dots: [dot(state.items.length, "Fin", null)] });
	const marks = dots.map((d) => d.dot.mark);
	const tally = (Object.entries(DONE_WORDS) as [DoneKind, (typeof DONE_WORDS)[DoneKind]][]).flatMap(([mark, { one, many }]) => {
		const n = marks.filter((m) => m === mark).length;
		return n ? [`${n} ${n > 1 ? many : one}`] : [];
	}).join(" · ");
	const screen = deckScreen(state);
	const position =
		screen === "sweep"
			? `Balayage ${Math.min(state.index + 1, swept)} / ${swept}`
			: screen === "ticket"
				? `Ticket ${state.index - swept + 1} / ${state.items.length - swept}`
				: "Fin";
	return { groups, position, tally };
}
