import type { InboxTicket } from "../remote/api";
import type { Remote } from "../remote/remote";
import { notToTriage, runTriage, type TriageDeps } from "../inbox/triage";
import type { DeckOutcome } from "./deckSession";
import type { DeckChoice } from "./ticketLine";

/**
 * The Deck's write (a card recorded with Enter, at the commit): Triage of `ticket` with `choice` into today's
 * Daily note. `stale` when the app no longer has it À trier, nothing written;
 * written when the app triaged it even if the note or the base failed after
 * (it is no longer À trier), the failure in `notice`, as the images that
 * stayed app links.
 */
export async function writeTicket(ticket: InboxTicket, choice: DeckChoice, deps: TriageDeps): Promise<{ outcome: DeckOutcome; notice?: string }> {
	const result = await runTriage(ticket, choice, deps);
	if (!result.ok && result.triaged) return { outcome: { kind: "written" }, notice: `${ticket.title} : ${result.error}` };
	if (!result.ok) return { outcome: result.stale ? { kind: "stale" } : { kind: "failed", error: result.error } };
	const notice =
		result.missingImages > 0
			? `${result.missingImages} image(s) du ticket non copiée(s) dans le coffre : le lien vers l'app est gardé.`
			: undefined;
	return { outcome: { kind: "written" }, ...(notice ? { notice } : {}) };
}

/** The Deck's archive (a card recorded with `x`, at the commit): `ticket` archived in the app with `comment` (null: none); `stale` when it is no longer À trier. */
export async function archiveTicket(ticket: InboxTicket, comment: string | null, remote: Pick<Remote, "archiveTicket">): Promise<DeckOutcome> {
	try {
		await remote.archiveTicket(ticket.id, comment);
		return { kind: "archived" };
	} catch (e) {
		if (notToTriage(e)) return { kind: "stale" };
		return { kind: "failed", error: e instanceof Error ? e.message : String(e) };
	}
}
