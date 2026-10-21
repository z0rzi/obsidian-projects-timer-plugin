import type { ProcessFile } from "../lineWriter";
import type { ApiEvent, EventType } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { SyncState } from "./pluginData";
import { NotInVault } from "./locateItem";
import { pullItemUpdated } from "./pullPriority";
import { pullItemAnswered } from "./pullAnswer";

/** The few vault operations a Pull needs (an in-memory map in tests). */
export interface VaultFiles {
	/** Current content, or null if there is no such file. */
	read(path: string): Promise<string | null>;
	/** Rewrites the file atomically with `edit` (Obsidian's `vault.process`). */
	process: ProcessFile;
	/** Edits the frontmatter of the file as an object (Obsidian's `fileManager.processFrontMatter`). */
	processFrontMatter(path: string, edit: (frontmatter: Record<string, unknown>) => void): Promise<void>;
	/** Every Markdown note, to find an item that left the note it was pushed from. */
	paths(): string[];
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
	/**
	 * Events that couldn't be applied. One whose item is in no note is kept in
	 * `SyncState.pullRetry` and retried at each Pull (reported once); others
	 * (line refused, file unreadable) are dropped.
	 */
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
	"item.answered": pullItemAnswered,
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
	const kept = deps.sync.pullRetry ?? [];
	const keptIds = new Set(kept.map((e) => e.id));
	const retry: ApiEvent[] = [];
	for (const event of [...kept, ...events.filter((e) => !keptIds.has(e.id))]) {
		const handler = handlers[event.type];
		if (!handler) continue;
		try {
			await handler(event, ctx);
		} catch (e) {
			const title = event.item ?? event.type;
			if (!(e instanceof NotInVault)) outcome.failed.push({ title, error: (e as Error).message });
			else {
				retry.push(event);
				if (!keptIds.has(event.id)) outcome.failed.push({ title, error: `${e.message}; kept, retried at the next Pull` });
			}
		}
	}
	const retryChanged = retry.length !== kept.length || retry.some((e, i) => e.id !== kept[i]!.id);
	if (retryChanged) {
		if (retry.length) deps.sync.pullRetry = retry;
		else delete deps.sync.pullRetry;
	}
	if (cursor !== deps.sync.cursor || retryChanged) {
		deps.sync.cursor = cursor;
		await deps.save();
	}
	return outcome;
}
