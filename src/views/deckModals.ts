import { TFile, type App } from "obsidian";
import { recordArchive, type DeckEffect, type DeckState } from "../deck/deckSession";
import { lineContext, type SweepLineContext } from "../deck/sweep";
import { chooseMove, sweepCount } from "../deck/sweepSession";
import { choose } from "../deck/ticketSession";
import type { VaultProject } from "../inbox/inboxStore";
import type { Zone } from "../remote/api";
import { ArchiveCommentModal } from "../ui/ArchiveCommentModal";
import { DeckPicker } from "../ui/DeckPicker";

/**
 * What the Deck view asks of Obsidian beyond its own DOM: the modals its session's effects open (the archive's
 * comment, the pickers) and the Sweep's notes read. `DeckView` hands each modal's answer back to the session.
 */

/** The Deck view as its modals see it: its session now, and where the session goes after a modal. */
export interface DeckModalHost {
	app: App;
	state(): DeckState | null;
	/** Back from a modal: `next` the session after it (null: unchanged), the keys to the Deck again. */
	back(next: DeckState | null): void;
	/** `run` on the next tick, unless the view unloads first: the pickers' cancel. */
	nextTick(run: () => void): void;
}

/** The modal of an effect: the archive's comment, a picker of the Ticket's line, the Project picker of a Sweep move. */
export function openEffectModal(host: DeckModalHost, effect: Exclude<DeckEffect, { kind: "commit" }>) {
	switch (effect.kind) {
		case "archive":
			new ArchiveCommentModal(
				host.app,
				effect.ticket.title,
				(comment) => {
					const state = host.state();
					host.back(state && recordArchive(state, comment));
				},
				() => host.back(null),
				effect.comment,
			).open();
			return;
		case "pick":
			return pick(host, effect.field);
		case "pickMove":
			return pickMove(host);
	}
}

/** The Project picker (Escape: none) or the Zone picker (Escape: unchanged). */
function pick(host: DeckModalHost, field: "project" | "zone") {
	const { projects, zones } = host.state()!.context;
	const tick = (run: () => void) => host.nextTick(run);
	if (field === "project") {
		new DeckPicker<VaultProject>(
			host.app,
			projects,
			(p) => p.title,
			"Projet (Échap : aucun)",
			(p) => host.back(choose(host.state()!, "project", { path: p.path, id: p.id })),
			() => host.back(choose(host.state()!, "project", null)),
			tick,
		).open();
	} else {
		new DeckPicker<Zone>(
			host.app,
			zones ?? [],
			(z) => z.name,
			"Zone",
			(z) => host.back(choose(host.state()!, "zone", z.id)),
			() => host.back(null),
			tick,
			(z) => z.path || null,
		).open();
	}
}

/** The Project picker of a Sweep move (Escape: nothing moves). */
function pickMove(host: DeckModalHost) {
	new DeckPicker<VaultProject>(
		host.app,
		host.state()!.context.projects,
		(p) => p.title,
		"Déplacer dans le projet (Échap : rien)",
		(p) => {
			const state = host.state();
			host.back(state && chooseMove(state, { path: p.path, id: p.id }));
		},
		() => host.back(null),
		(run) => host.nextTick(run),
	).open();
}

/** The Sweep's lines of `state` read in their notes (one read each, from the cache), by item index; null: no longer there. */
export async function readSweepLines(app: App, state: DeckState): Promise<Record<number, SweepLineContext | null>> {
	const items = state.items.slice(0, sweepCount(state));
	const paths = [...new Set(items.map((i) => (i.kind === "sweep" ? i.task.path : "")))];
	const contents = new Map<string, string | null>();
	await Promise.all(
		paths.map(async (path) => {
			const file = app.vault.getAbstractFileByPath(path);
			contents.set(path, file instanceof TFile ? await app.vault.cachedRead(file) : null);
		}),
	);
	const lines: Record<number, SweepLineContext | null> = {};
	items.forEach((item, i) => {
		if (item.kind !== "sweep") return;
		const content = contents.get(item.task.path);
		lines[i] = content == null ? null : lineContext(content, item.task);
	});
	return lines;
}
