import { moveTo, type DeckDecision, type DeckItem, type DeckKey, type DeckState, type DeckStep } from "./deckSession";
import { SWEEP_ERRORS, type SweepCandidate, type SweepLineContext } from "./sweep";

/**
 * The Sweep's part of the Deck session (`deckSession.ts`), pure: its items
 * open the day's first session as one list, before the Tickets. `j`/`k` move
 * between its rows; the keys act on the focused row, each recording the
 * line's decision (written when the session commits), then focus the next
 * undecided row: `z` the Frigo, `m` a move into a Project note (picked,
 * `chooseMove`), Enter a keep until the item's day (a line not Pushed yet
 * can't be kept: a message, nothing else). No key acts on several rows. A line
 * no longer in its note (`withSweepLines`) takes no key. The last row,
 * « Continuer », focused once every row has a decision, goes on with Enter;
 * rows left undecided are not written. `u` goes back to the previous decision, in the order they were made
 * (the focus wraps, so a decision above the focus may be a later one).
 */

/** The Sweep's candidates as session items, in their order, each kept until `keepUntil` by Enter. */
export function sweepItems(candidates: SweepCandidate[], keepUntil: string): DeckItem[] {
	return candidates.map((task) => ({ kind: "sweep", task, keepUntil }));
}

/** How many Sweep items the session opens with; the index of the list's « Continuer » row. */
export function sweepCount(state: Pick<DeckState, "items">): number {
	return state.items.filter((i) => i.kind === "sweep").length;
}

/** The Sweep's lines as read in their notes when the list opens (by item index; null: no longer in its note). */
export function withSweepLines(state: DeckState, lines: Record<number, SweepLineContext | null>): DeckState {
	return { ...state, sweepLines: { ...state.sweepLines, ...lines } };
}

/** The first undecided row after `from`, else before it; the « Continuer » row when every row has a decision. */
function nextUndecided(decisions: (DeckDecision | null)[], from: number, count: number): number {
	const rows = Array.from({ length: count }, (_, i) => (from + 1 + i) % count);
	return rows.find((i) => !decisions[i]) ?? count;
}

/** `decision` recorded for the focused row, the latest in `sweepOrder`, then on to the next undecided one. */
function decideRow(state: DeckState, decision: DeckDecision): DeckState {
	const decisions = [...state.decisions];
	decisions[state.index] = decision;
	const sweepOrder = [...state.sweepOrder.filter((i) => i !== state.index), state.index];
	return { ...state, decisions, sweepOrder, index: nextUndecided(decisions, state.index, sweepCount(state)) };
}

/**
 * `u` on the list: the row of the latest decision not gone back to yet, the ones gone back to dropped from
 * `sweepOrder` (the focused row's first: back from the Tickets, the list opens on it); null when none is left.
 */
function backInList(state: DeckState): DeckState | null {
	const order = [...state.sweepOrder];
	while (order.at(-1) === state.index) order.pop();
	const previous = order.pop();
	return previous === undefined ? null : { ...state, sweepOrder: order, index: previous };
}

/** A key on the Sweep list; any other changes nothing. */
export function pressOnSweep(state: DeckState, key: DeckKey): DeckStep {
	const count = sweepCount(state);
	const row = state.index;
	const same = { state, effects: [] };
	switch (key) {
		case "j":
		case "k":
			return { state: { ...state, index: Math.max(0, Math.min(count, row + (key === "j" ? 1 : -1))) }, effects: [] };
		case "u": {
			const back = backInList(state);
			return back ? { state: back, effects: [] } : same;
		}
	}
	if (row === count) return key === "Enter" ? { state: moveTo(state, count), effects: [] } : same;
	if (key !== "z" && key !== "m" && key !== "Enter") return same;
	const item = state.items[row] as Extract<DeckItem, { kind: "sweep" }>;
	if (state.sweepLines[row] === null) return { state: { ...state, message: { kind: "info", text: SWEEP_ERRORS.missing } }, effects: [] };
	switch (key) {
		case "z":
			return { state: decideRow(state, { kind: "frigo" }), effects: [] };
		case "m":
			return { state, effects: [{ kind: "pickMove", task: item.task }] };
		case "Enter":
			// The keep is the app's (`kept_until`): a line the app does not hold yet can't be kept.
			if (item.task.id === null) {
				const text = `Garder demande une ligne poussée : « ${item.task.title} » n'est pas encore dans l'app (z ou m la traitent).`;
				return { state: { ...state, message: { kind: "info", text } }, effects: [] };
			}
			return { state: decideRow(state, { kind: "keep", until: item.keepUntil }), effects: [] };
	}
}

/** The Project picker's choice for the focused Sweep line's move, recorded (null: Escape, nothing recorded). */
export function chooseMove(state: DeckState, project: { path: string; id: string } | null): DeckState {
	const item = state.items[state.index];
	if (!state.sweeping || !item || item.kind !== "sweep" || state.phase !== "deciding" || !project) return state;
	return decideRow(state, { kind: "move", project });
}
