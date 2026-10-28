import type { InboxTicket, TriagePriority, TriageTaskType } from "../remote/api";
import { currentItem, decide, type DeckEffect, type DeckKey, type DeckState, type DeckStep } from "./deckSession";
import { clientLine, clientProject, DECK_FIELDS, stepValue, withPriority, withType, type DeckChoice } from "./ticketLine";

/**
 * The keys on a Ticket's card (`deckSession.ts`), pure: `j`/`k` a field, `h`/`l` a value, the type and
 * Priority keys, `p`/`o` the pickers (their choice back with `choose`), `x` the archive, Enter the line, `.`
 * the previous Ticket's, `s` a skip.
 */

const TYPE_KEYS: Partial<Record<DeckKey, TriageTaskType>> = { b: "bug", t: "task", w: "wait", i: "idea" };

const PRIORITY_KEYS: Partial<Record<DeckKey, TriagePriority>> = { "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, z: "pz" };

/** `choice` as `ticket`'s, a Project or Zone that is not the Client's becoming its own on the row (`RowPicks`). */
export function withChoice(state: DeckState, ticket: InboxTicket, choice: DeckChoice): DeckState {
	const old = state.picks[ticket.id] ?? { project: null, zone: null };
	const project = choice.project && choice.project.path !== clientProject(ticket, state.context)?.path ? choice.project : old.project;
	const zone = choice.zone != null && choice.zone !== clientLine(ticket, state.context).zone ? choice.zone : old.zone;
	return { ...state, choices: { ...state.choices, [ticket.id]: choice }, picks: { ...state.picks, [ticket.id]: { project, zone } } };
}

/** The line of the nearest Ticket before the current one recorded to be written, for `.`; null when none. */
function previousChoice(state: DeckState): DeckChoice | null {
	for (let i = state.index - 1; i >= 0; i--) {
		const decision = state.decisions[i];
		if (state.items[i]?.kind === "ticket" && decision?.kind === "write") return decision.choice;
	}
	return null;
}

export function pressOnTicket(state: DeckState, ticket: InboxTicket, key: DeckKey): DeckStep {
	const choice = state.choices[ticket.id]!;
	const set = (next: DeckChoice): DeckStep => ({ state: withChoice(state, ticket, next), effects: [] });
	const fieldAt = (step: number) => DECK_FIELDS[Math.max(0, Math.min(DECK_FIELDS.length - 1, DECK_FIELDS.indexOf(state.field) + step))]!;
	switch (key) {
		case "j":
		case "k":
			return { state: { ...state, field: fieldAt(key === "j" ? 1 : -1) }, effects: [] };
		case "h":
		case "l":
			return set(stepValue(choice, state.field, key === "l" ? 1 : -1, ticket, state.context, state.picks[ticket.id]));
		case "q":
			return set(withPriority(choice, "pq"));
		case "p":
		case "o": {
			const field = key === "p" ? "project" : "zone";
			// No Zone to pick from when they could not be loaded: the Client's stays.
			const pick: DeckEffect[] = field === "zone" && !state.context.zones ? [] : [{ kind: "pick", field, ticket }];
			return { state: { ...state, field }, effects: pick };
		}
		case "x": {
			const recorded = state.decisions[state.index];
			return { state, effects: [{ kind: "archive", ticket, comment: recorded?.kind === "archive" ? recorded.comment : null }] };
		}
		case "Enter":
			return { state: decide(state, { kind: "write", choice }), effects: [] };
		case ".": {
			const previous = previousChoice(state);
			if (!previous) return { state, effects: [] };
			const step = set(previous);
			return { ...step, state: { ...step.state, message: { kind: "info", text: "comme le précédent", brief: true } } };
		}
		case "s":
			return { state: decide(state, { kind: "skip" }), effects: [] };
		case "m":
		case "u":
			return { state, effects: [] };
	}
	const type = TYPE_KEYS[key];
	if (type) return set(withType(choice, type, ticket));
	const priority = PRIORITY_KEYS[key];
	if (priority !== undefined) return set(withPriority(choice, priority));
	return { state, effects: [] };
}

/** A picker's choice for the current Ticket: a Project (null: none, Escape on the Project picker) or a Zone (null: none). */
export function choose(state: DeckState, field: "project", value: DeckChoice["project"]): DeckState;
export function choose(state: DeckState, field: "zone", value: number | null): DeckState;
export function choose(state: DeckState, field: "project" | "zone", value: DeckChoice["project"] | number | null): DeckState {
	const item = currentItem(state);
	if (!item || item.kind !== "ticket") return state;
	return { ...withChoice(state, item.ticket, { ...state.choices[item.ticket.id]!, [field]: value }), field };
}
