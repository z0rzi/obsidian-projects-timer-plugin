import type { VaultProject } from "../inbox/inboxStore";
import { localDay } from "../localDate";
import type { InboxResponse, StateResponse } from "../remote/api";
import { startSession, ticketItems, type DeckItem, type DeckState } from "./deckSession";
import { addDays, firstSessionToday, sweepCandidates } from "./sweep";
import type { SweepDeps } from "./sweepDeps";
import { sweepItems } from "./sweepSession";

/** What a new Deck session is read from: the app's Tickets and state, the Sweep's notes, the Project notes. */
export interface LoadDeps {
	inbox(): Promise<InboxResponse>;
	fullState(): Promise<StateResponse>;
	/** The Sweep's vault side; null when it can't run (no projects location). */
	sweep: Pick<SweepDeps, "options" | "notes"> | null;
	projects: VaultProject[];
	now: Date;
	/** Tells the Developer something went wrong without stopping the session. */
	notify(message: string): void;
}

/**
 * A new session: the app's Tickets À trier, oldest first, after the Sweep's candidates on the day's first
 * session (no Deck write in the app's state today, `deck_at`). Without the app's state, no Zones and no Sweep
 * (a notice). Without the Tickets the Sweep still runs, the session saying why there are no Tickets
 * (`ticketsError`); with nothing to sweep either, the Tickets' failure is thrown.
 */
export async function loadSession(deps: LoadDeps): Promise<DeckState> {
	const [inbox, state] = await Promise.all([
		deps.inbox().catch((e: Error) => e),
		deps.fullState().catch((e: Error): StateResponse | null => {
			deps.notify(`État de l'app indisponible (${e.message}) : ni zones ni balayage.`);
			return null;
		}),
	]);
	let sweeping: DeckItem[] = [];
	if (state && deps.sweep && firstSessionToday(state.deck_at, deps.now)) {
		const today = localDay(deps.now);
		const { options } = deps.sweep;
		sweeping = sweepItems(sweepCandidates(await deps.sweep.notes(), state.items, options, today), addDays(today, options.age));
	}
	if (inbox instanceof Error && sweeping.length === 0) throw inbox;
	const tickets = inbox instanceof Error ? [] : ticketItems(inbox.to_triage ?? []);
	const session = startSession([...sweeping, ...tickets], { projects: deps.projects, zones: state?.zones ?? null });
	return inbox instanceof Error ? { ...session, ticketsError: inbox.message } : session;
}
