import type { ApiEvent, EventType } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { SyncState } from "./pluginData";
import { pullItemUpdated } from "./pullPriority";
import { pullReviewAnswered } from "./pullReview";

/** The few vault operations a Pull needs (an in-memory map in tests). */
export interface VaultFiles {
	/** Current content, or null if there is no such file. */
	read(path: string): Promise<string | null>;
	/** Rewrites the file atomically with `edit` (Obsidian's `vault.process`). */
	process(path: string, edit: (content: string) => string): Promise<void>;
}

export interface PullDeps {
	remote: Remote;
	sync: SyncState;
	/** Persists `sync`. */
	save: () => Promise<void>;
	files: VaultFiles;
}

export interface PullOutcome {
	/** Vault writes made. */
	applied: number;
	/** New conflicts, for the Push modal. */
	conflicts: number;
	/** Events that couldn't be applied (line gone, file unreadable); they are not retried. */
	failed: { title: string; error: string }[];
}

/** What a handler gets: the deps and the outcome it reports into. */
export interface PullContext extends PullDeps {
	outcome: PullOutcome;
}

export type PullHandler = (event: ApiEvent, ctx: PullContext) => Promise<void>;

/**
 * One handler per event type the vault cares about; the others (creations
 * echoing a Push, comments…) are skipped. Later tickets add theirs here.
 */
export const PULL_HANDLERS: Partial<Record<EventType, PullHandler>> = {
	"item.updated": pullItemUpdated,
	"review.answered": pullReviewAnswered,
};

/**
 * Fetches the events after the saved cursor and hands each, oldest first, to
 * its handler. The cursor is saved once all are handled, so repeated Pulls
 * with no new events change nothing. A whole-call failure (app down, bad
 * token) throws a RemoteError and keeps the cursor.
 */
export async function runPull(deps: PullDeps, handlers = PULL_HANDLERS): Promise<PullOutcome> {
	const outcome: PullOutcome = { applied: 0, conflicts: 0, failed: [] };
	const { events, cursor } = await deps.remote.pull(deps.sync.cursor ?? null);
	const ctx: PullContext = { ...deps, outcome };
	for (const event of events) {
		const handler = handlers[event.type];
		if (!handler) continue;
		try {
			await handler(event, ctx);
		} catch (e) {
			outcome.failed.push({ title: event.item ?? event.type, error: (e as Error).message });
		}
	}
	if (cursor !== deps.sync.cursor) {
		deps.sync.cursor = cursor;
		await deps.save();
	}
	return outcome;
}
