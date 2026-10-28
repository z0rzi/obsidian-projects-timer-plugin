import type { PushReport } from "./pushReport";
import { backFromCard, moveTo, type CardResult, type DeckCard, type DeckKey, type DeckState, type DeckStep } from "./deckSession";
import { sweepCount } from "./sweepSession";

/**
 * The end screen of a Deck session (`deckSession.ts`) and its commit, pure: its rows (`endTargets`), its keys,
 * the cards written in turn (`cardDone`), the closing Push (`commitDone`), the failed ones again (`retryFailed`).
 */

/**
 * The end screen's rows, as the card each reopens: every Ticket decided, in order, then the Sweep's lines
 * grouped by outcome (au frigo, gardées, déplacées), a group reopening the Sweep list on its first line. The
 * row after the last is « Tout écrire ».
 */
export function endTargets(state: DeckState): number[] {
	const decided = state.items.flatMap((item, i) => (state.decisions[i] ? [{ item, i, kind: state.decisions[i]!.kind }] : []));
	const tickets = decided.filter((d) => d.item.kind === "ticket").map((d) => d.i);
	const groups = SWEEP_OUTCOMES.flatMap((kind) => {
		const first = decided.find((d) => d.item.kind === "sweep" && d.kind === kind);
		return first ? [first.i] : [];
	});
	return [...tickets, ...groups];
}

/** The Sweep's outcomes in the end screen's order. */
export const SWEEP_OUTCOMES = ["frigo", "keep", "move"] as const;

/** Keys on the end screen: `j`/`k` a row, Enter its card or « Tout écrire », `u` the previous card. */
export function pressOnEnd(state: DeckState, key: DeckKey): DeckStep {
	const targets = endTargets(state);
	const row = state.endRow ?? targets.length;
	const focus = (next: number): DeckStep => {
		const at = Math.max(0, Math.min(targets.length, next));
		return { state: { ...state, endRow: at === targets.length ? null : at }, effects: [] };
	};
	switch (key) {
		case "j":
			return focus(row + 1);
		case "k":
			return focus(row - 1);
		case "u":
			return { state: backFromCard(state) ?? state, effects: [] };
		case "Enter": {
			if (row === targets.length) return { state: { ...state, phase: "committing" }, effects: [{ kind: "commit", cards: commitCardsOf(state) }] };
			const target = targets[row]!;
			return { state: moveTo(state, target, target < sweepCount(state)), effects: [] };
		}
		default:
			return { state, effects: [] };
	}
}

/** The cards the commit writes, in the session's order: every item with a decision. */
export function commitCardsOf(state: DeckState): DeckCard[] {
	return state.items.flatMap((item, index) => {
		const decision = state.decisions[index];
		return decision ? [{ index, item, decision }] : [];
	});
}

/** The card at `index` written as `result`, while the session commits. */
export function cardDone(state: DeckState, index: number, result: CardResult): DeckState {
	if (state.phase !== "committing") return state;
	const results = [...state.results];
	results[index] = result;
	return { ...state, results };
}

/** Every card written and the closing Push run (`pushed`, null: nothing pushed): the session is over, its report shown. */
export function commitDone(state: DeckState, pushed: PushReport | null): DeckState {
	if (state.phase !== "committing") return state;
	return { ...state, phase: "done", pushed };
}

/** « Réessayer les échecs » on the report: the failed cards written again, alone; unchanged without one. */
export function retryFailed(state: DeckState): DeckStep {
	const failed = new Set(state.results.flatMap((r, i) => (r?.kind === "failed" ? [i] : [])));
	if (state.phase !== "done" || failed.size === 0) return { state, effects: [] };
	const results = state.results.map((r, i) => (failed.has(i) ? null : r));
	const cards = commitCardsOf(state).filter((c) => failed.has(c.index));
	return { state: { ...state, phase: "committing", results, pushed: null }, effects: [{ kind: "commit", cards }] };
}
