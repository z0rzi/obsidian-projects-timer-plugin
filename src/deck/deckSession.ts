import type { InboxTicket } from "../remote/api";
import { pressOnEnd } from "./deckEnd";
import type { PushReport } from "./pushReport";
import type { SweepCandidate, SweepLineContext } from "./sweep";
import { pressOnSweep, sweepCount } from "./sweepSession";
import { DECK_FIELDS, defaultChoice, type DeckChoice, type DeckContext, type DeckField, type RowPicks } from "./ticketLine";
import { pressOnTicket, withChoice } from "./ticketSession";

/**
 * The Deck's session (spec « Plugin: Triage, Deck and Sweep »), pure: no DOM,
 * no Obsidian. The view renders the state and forwards key names to `press`;
 * the effects `press` returns (ask an archive's comment, pick, commit, end)
 * are run by the view, which hands back an archive's comment with
 * `recordArchive` and a picker's choice with `choose`. One item at a time,
 * oldest first as the caller orders them; every choice on a key.
 *
 * A session has three screens, in this order, each skipped when empty
 * (`deckScreen`): the Sweep list, the Tickets one card at a time, the end
 * screen. Deciding writes nothing: Enter, `x`, `s` (and the Sweep's keys)
 * record the card's decision and go on; `u` goes back a card, its decision
 * shown and replaced by deciding again; `goTo` (a click on the progress strip)
 * goes to any card already reached. The end screen lists the decisions, a row
 * reopening its card; Enter on « Tout écrire » commits: the view writes every
 * card in order (`deckCommit.ts`), reporting each with `cardDone`, then the
 * closing Push's result with `commitDone`, and the end screen becomes the
 * report; `retryFailed` writes the failed cards again (`deckEnd.ts`).
 *
 * A Ticket's line, its defaults and the Rapide rule are `ticketLine.ts`'s,
 * its keys `ticketSession.ts`'s.
 *
 * The Sweep's items (first session of the day, before the Tickets) are one
 * list with keys of its own (`sweepSession.ts`): `j`/`k` a row, `z` the
 * Frigo, `m` a move into a Project note (picked), Enter a keep until the
 * item's day, a last row « Continuer » going on to the Tickets.
 */

/**
 * What a session goes through, in order: the Sweep's Tag tasks (`keepUntil`:
 * the day Enter keeps one until, today plus the sweep age), then the Tickets.
 */
export type DeckItem = { kind: "ticket"; ticket: InboxTicket } | { kind: "sweep"; task: SweepCandidate; keepUntil: string };

/**
 * What a card will do once the session commits: a Ticket written with its
 * line, archived with its comment (null: none) or skipped; a Sweep line sent
 * to the Frigo, moved into a Project note or kept until a day.
 */
export type DeckDecision =
	| { kind: "write"; choice: DeckChoice }
	| { kind: "archive"; comment: string | null }
	| { kind: "skip" }
	| { kind: "frigo" }
	| { kind: "move"; project: { path: string; id: string } }
	| { kind: "keep"; until: string };

/**
 * Each decision once done, as its card's result and its dot on the progress strip name it (the decision says
 * what to do, « keep », the result what was done, « kept »).
 */
export const DONE_KIND = {
	write: "written",
	archive: "archived",
	skip: "skipped",
	frigo: "frigo",
	move: "moved",
	keep: "kept",
} as const satisfies Record<DeckDecision["kind"], string>;

export type DoneKind = (typeof DONE_KIND)[DeckDecision["kind"]];

/** What committing a card did: its decision done, the Ticket stale (nothing written), or failed (the card undone). */
export type CardResult = { kind: DoneKind | "stale" } | { kind: "failed"; error: string };

/** A card the commit writes: its place in the session, its item, its decision. */
export interface DeckCard {
	index: number;
	item: DeckItem;
	decision: DeckDecision;
}

/** Deciding (cards, then the end screen), writing the decisions, or over (the report). */
export type DeckPhase = "deciding" | "committing" | "done";

/**
 * A message under the fields: information (a line that can't be kept, « comme
 * le précédent ») or a failure. `brief`: the view clears it after a moment.
 */
export interface DeckMessage {
	kind: "info" | "error";
	text: string;
	brief?: true;
}

/** What the Deck shows: nothing to triage, the Sweep list, a Ticket, the end screen (the report once it writes). */
export type DeckScreen = "empty" | "sweep" | "ticket" | "end";

export interface DeckState {
	items: DeckItem[];
	/**
	 * The current item; `items.length` on the end screen. On the Sweep list the focused row, the number of Sweep
	 * items for the « Continuer » row.
	 */
	index: number;
	/** The Sweep list is shown. */
	sweeping: boolean;
	/** The end screen's focused row (`endTargets`); null: « Tout écrire ». */
	endRow: number | null;
	/** Each Sweep line in its note by its item's index, read when the list opens; null: no longer in its note. */
	sweepLines: Record<number, SweepLineContext | null>;
	/** The Sweep rows in the order their decisions were made, the latest last: `u`'s way back on the list. */
	sweepOrder: number[];
	/** The closing Push's result once the session is written; null when nothing was pushed. */
	pushed: PushReport | null;
	/** Why the session has no Tickets when the app's could not be read (the Sweep going on alone); null otherwise. */
	ticketsError: string | null;
	/** The current field of the current item. */
	field: DeckField;
	/** The choice of each Ticket by its id, the defaults first. */
	choices: Record<string, DeckChoice>;
	/** Each Ticket's own Projet and Zone values by its id (`withChoice`); none before one. */
	picks: Record<string, RowPicks>;
	/** The decision recorded for each item, by its index; null before one. */
	decisions: (DeckDecision | null)[];
	phase: DeckPhase;
	/** What committing did to each item, by its index; null before it is written. */
	results: (CardResult | null)[];
	/** The last message for the Developer (a line that can't be kept), null for none. */
	message: DeckMessage | null;
	context: DeckContext;
}

/** The Tickets as session items, oldest first (sent first; by id on the same instant), as Triage takes them. */
export function ticketItems(tickets: InboxTicket[]): DeckItem[] {
	const sorted = [...tickets].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
	return sorted.map((ticket) => ({ kind: "ticket", ticket }));
}

/** A session over `items`, in the caller's order, each Ticket with its default choice, nothing decided. */
export function startSession(items: DeckItem[], context: DeckContext): DeckState {
	return {
		items,
		index: 0,
		sweeping: items[0]?.kind === "sweep",
		endRow: null,
		sweepLines: {},
		sweepOrder: [],
		pushed: null,
		ticketsError: null,
		field: "type",
		choices: Object.fromEntries(items.flatMap((i) => (i.kind === "ticket" ? [[i.ticket.id, defaultChoice(i.ticket, context)]] : []))),
		picks: {},
		decisions: items.map(() => null),
		phase: "deciding",
		results: items.map(() => null),
		message: null,
		context,
	};
}

/** Every key the session knows, in the legend's order. */
export const DECK_KEYS = ["j", "k", "h", "l", "b", "q", "t", "w", "i", "0", "1", "2", "3", "4", "5", "z", "p", "o", "x", "Enter", ".", "s", "u", "m"] as const;

export type DeckKey = (typeof DECK_KEYS)[number];

/**
 * Something the view runs for the session: the archive's comment to ask (the
 * one recorded before as its default), a picker, the Sweep's Project picker of
 * a move (its choice to `chooseMove`), the commit of the cards decided.
 */
export type DeckEffect =
	| { kind: "archive"; ticket: InboxTicket; comment: string | null }
	| { kind: "pick"; field: "project" | "zone"; ticket: InboxTicket }
	| { kind: "pickMove"; task: SweepCandidate }
	| { kind: "commit"; cards: DeckCard[] };

/**
 * How a write went (`deckRun.ts`, `sweepRun.ts`): done, refused because the
 * app no longer has the Ticket À trier (it answered 409 or 404: withdrawn,
 * edited or triaged meanwhile), or failed.
 */
export type DeckOutcome = { kind: "written" } | { kind: "archived" } | { kind: "stale" } | { kind: "failed"; error: string } | SweptOutcome;

/** A Sweep write went: `passed` items gone through, `done` of them written. */
export type SweptOutcome = { kind: "swept"; how: Extract<DoneKind, "frigo" | "moved" | "kept">; passed: number; done: number };

export type DeckStep = { state: DeckState; effects: DeckEffect[] };

/** The screen the session is on. */
export function deckScreen(state: DeckState): DeckScreen {
	if (state.items.length === 0) return "empty";
	if (state.sweeping) return "sweep";
	return state.index < state.items.length ? "ticket" : "end";
}

/** The current item: a Ticket, the Sweep list's focused line; undefined on « Continuer » and the end screen. */
export function currentItem(state: DeckState): DeckItem | undefined {
	if (state.sweeping && state.index >= sweepCount(state)) return undefined;
	return state.items[state.index];
}

/**
 * The state and effects after the key `key` (a `KeyboardEvent.key`); an
 * unknown key, or any once the session commits, changes nothing. `u` goes back
 * a card; on the end screen, Enter reopens the focused row's card or, on
 * « Tout écrire », commits.
 */
export function press(state: DeckState, key: string): DeckStep {
	if (state.phase !== "deciding" || !(DECK_KEYS as readonly string[]).includes(key)) return { state, effects: [] };
	const s = { ...state, message: null };
	switch (deckScreen(state)) {
		case "empty":
			return { state, effects: [] };
		case "sweep":
			return pressOnSweep(s, key as DeckKey);
		case "end":
			return pressOnEnd(s, key as DeckKey);
		case "ticket": {
			if (key !== "u") return pressOnTicket(s, (currentItem(state) as Extract<DeckItem, { kind: "ticket" }>).ticket, key as DeckKey);
			const back = backFromCard(s);
			return { state: back ?? state, effects: [] };
		}
	}
}

/**
 * `u` on a Ticket or the end screen: the previous card, the Sweep list (on its last decision) before the first
 * Ticket; null when there is none.
 */
export function backFromCard(state: DeckState): DeckState | null {
	const swept = sweepCount(state);
	if (state.index > swept) return moveTo(state, state.index - 1);
	if (swept === 0) return null;
	return moveTo(state, state.sweepOrder.at(-1) ?? swept, true);
}

/**
 * The card at `index`, on its first field (`sweeping`: the Sweep list, on that row). The card left goes back to
 * its recorded line, if it has one: a change not followed by Enter is not one.
 */
export function moveTo(state: DeckState, index: number, sweeping = false): DeckState {
	const left = currentItem(state);
	const decision = state.decisions[state.index];
	const restored = left?.kind === "ticket" && decision?.kind === "write" ? withChoice(state, left.ticket, decision.choice) : state;
	return { ...restored, index, sweeping, endRow: null, field: DECK_FIELDS[0], message: null };
}

/**
 * The furthest card the session reached: past every card decided, and the
 * current one; `items.length` is the end screen. A card is only left forward
 * by deciding it, so the decisions tell how far the Developer went.
 */
export function furthestReached(state: DeckState): number {
	const lastDecided = state.decisions.reduce((last, d, i) => (d ? i : last), -1);
	return Math.max(state.index, lastDecided + 1);
}

/**
 * The card at `index` (`items.length`: the end screen), back or forward, a
 * click on the progress strip: a Sweep line focused on the list, always
 * there; unchanged for a card not reached yet, the current one, or once the
 * session writes.
 */
export function goTo(state: DeckState, index: number): DeckState {
	const sweeping = index < sweepCount(state);
	if (state.phase !== "deciding" || index < 0 || (index === state.index && sweeping === state.sweeping)) return state;
	if (!sweeping && index > furthestReached(state)) return state;
	return moveTo(state, index, sweeping);
}

/** `decision` recorded for the current card, then on to the next (or the end screen). */
export function decide(state: DeckState, decision: DeckDecision): DeckState {
	const decisions = [...state.decisions];
	decisions[state.index] = decision;
	return { ...state, decisions, index: state.index + 1, field: DECK_FIELDS[0] };
}

/** The archive of the current Ticket recorded with `comment` (null: none), once the view asked it. */
export function recordArchive(state: DeckState, comment: string | null): DeckState {
	const item = currentItem(state);
	if (state.phase !== "deciding" || item?.kind !== "ticket") return state;
	return decide(state, { kind: "archive", comment });
}

/** How many cards have a decision recorded, none written yet. */
export function decisionCount(state: DeckState): number {
	return state.decisions.filter((d) => d !== null).length;
}
