import type { InboxTicket } from "../remote/api";
import { DONE_KIND, type CardResult, type DeckCard, type DeckOutcome } from "./deckSession";
import type { DeckChoice } from "./ticketLine";
import type { SweepCandidate } from "./sweep";

/**
 * The commit of a Deck session (Enter on its end screen): each card's
 * decision done in the session's order, as the keys did before ticket 29: a
 * Triage write into today's Daily note, an archive, the Sweep's `pz`, move or
 * keep. A failing card stays undone (still À trier, its line where it was)
 * and the others go on. The closing Push follows, run by the view
 * (`DeckViewDeps.push`) for its report.
 */

/** The writes the commit runs, one card at a time (`deckRun.ts`, `sweepRun.ts`). */
export interface CommitDeps {
	/** Triage of `ticket` into today's Daily note; `notice`: something to tell (images not copied). */
	write(ticket: InboxTicket, choice: DeckChoice): Promise<{ outcome: DeckOutcome; notice?: string }>;
	/** `ticket` archived in the app with `comment` (null: none). */
	archive(ticket: InboxTicket, comment: string | null): Promise<DeckOutcome>;
	/** `pz` on the lines of `tasks`. */
	frigo(tasks: SweepCandidate[]): Promise<{ outcome: DeckOutcome }>;
	/** The line moved into the Project note `project`. */
	move(task: SweepCandidate, project: { path: string; id: string }): Promise<DeckOutcome>;
	/** The Task kept in the app until `until`. */
	keep(task: SweepCandidate, until: string): Promise<DeckOutcome>;
	/** Shows a notice. */
	notify(message: string): void;
}

/** A write's outcome as the card's result; a Sweep write that wrote nothing failed. */
function resultOf(outcome: DeckOutcome): CardResult {
	if (outcome.kind !== "swept") return outcome;
	return outcome.done > 0 ? { kind: outcome.how } : { kind: "failed", error: "rien d'écrit" };
}

/** What `card`'s decision does. */
async function commitCard({ item, decision }: DeckCard, deps: CommitDeps): Promise<CardResult> {
	if (item.kind === "ticket") {
		switch (decision.kind) {
			case "write": {
				const { outcome, notice } = await deps.write(item.ticket, decision.choice);
				if (notice) deps.notify(notice);
				return resultOf(outcome);
			}
			case "archive":
				return resultOf(await deps.archive(item.ticket, decision.comment));
			case "skip":
				return { kind: DONE_KIND.skip };
		}
	} else {
		switch (decision.kind) {
			case "frigo":
				return resultOf((await deps.frigo([item.task])).outcome);
			case "move":
				return resultOf(await deps.move(item.task, decision.project));
			case "keep":
				return resultOf(await deps.keep(item.task, decision.until));
		}
	}
	return { kind: "failed", error: `décision « ${decision.kind} » inattendue` };
}

/** Every card of `cards` committed in turn, each result handed to `done` as soon as it is known. */
export async function commitCards(cards: DeckCard[], deps: CommitDeps, done: (index: number, result: CardResult) => void): Promise<void> {
	for (const card of cards) {
		let result: CardResult;
		try {
			result = await commitCard(card, deps);
		} catch (e) {
			result = { kind: "failed", error: e instanceof Error ? e.message : String(e) };
		}
		done(card.index, result);
	}
}
