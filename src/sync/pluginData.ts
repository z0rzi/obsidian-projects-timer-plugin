import type { ApiEvent } from "../remote/api";
import type { PullConflict } from "./pullPriority";
import type { PushedProjects } from "./pushPlan";
import type { PushedTasks } from "./taskPlan";

/** What the plugin remembers about the Client app between sessions (one machine only). */
export interface SyncState {
	/** Last-pushed shared fields of each Project, by app id: the base for "changed (old → new)". */
	pushedProjects: PushedProjects;
	/** Same for Tasks, by app id (= block ID). */
	pushedTasks: PushedTasks;
	/**
	 * Done lines without a date (`[x]` steps, undated `#done`) that were left
	 * out of the first Push, as `path\nline`. Unset until a first Push applied.
	 */
	doneHistory?: string[];
	/** Id of the last app event handled by the Pull (`GET /api/events?since=`); unset = never pulled. */
	cursor?: number;
	/** Pulled events whose item is in no note right now, retried at each Pull (oldest first). */
	pullRetry?: ApiEvent[];
	/** Client changes not applied because the vault changed the same field, by `<id>:<field>`. */
	conflicts?: Record<string, PullConflict>;
	/**
	 * Vault images already in the app, by vault path: brought in by Triage or
	 * uploaded by a Push. A Push reuses the URL while the file keeps its size.
	 */
	appImages?: Record<string, { url: string; bytes: number }>;
}

/** The last-pushed snapshot of the Project or Task `id`. */
export function pushedItem(
	sync: SyncState,
	kind: "project" | "task",
	id: string,
): PushedProjects[string] | PushedTasks[string] | undefined {
	return kind === "project" ? sync.pushedProjects[id] : sync.pushedTasks[id];
}

const emptySync = (): SyncState => ({ pushedProjects: {}, pushedTasks: {} });

/** The keys a SyncState has; anything else in data.json (state of removed features) is dropped on load. */
const SYNC_KEYS: Record<keyof SyncState, true> = {
	pushedProjects: true,
	pushedTasks: true,
	doneHistory: true,
	cursor: true,
	pullRetry: true,
	conflicts: true,
	appImages: true,
};

function readSync(raw: unknown): SyncState {
	const known = Object.entries((raw ?? {}) as Record<string, unknown>).filter(([key]) => key in SYNC_KEYS);
	return { ...emptySync(), ...(Object.fromEntries(known) as Partial<SyncState>) };
}

/**
 * The plugin's data.json: settings at the top level (as before) plus the
 * sync state under `sync`. Both are always written together by `save()`, so
 * saving one never drops the other.
 */
export class PluginData<S extends object> {
	private constructor(
		readonly settings: S,
		readonly sync: SyncState,
		private readonly write: (data: unknown) => Promise<void>,
	) {}

	static async load<S extends object>(
		defaults: S,
		read: () => Promise<unknown>,
		write: (data: unknown) => Promise<void>,
	): Promise<PluginData<S>> {
		const raw = ((await read()) ?? {}) as Record<string, unknown>;
		const { sync, ...settings } = raw;
		return new PluginData(
			Object.assign({}, defaults, settings) as S,
			readSync(sync),
			write,
		);
	}

	private queue: Promise<unknown> = Promise.resolve();

	/** Runs `job` after the previous ones settle, so a Pull and a Push never touch the sync state at once. */
	exclusive<T>(job: () => Promise<T>): Promise<T> {
		const run = this.queue.then(job, job);
		this.queue = run.catch(() => undefined);
		return run;
	}

	save(): Promise<void> {
		return this.write({ ...this.settings, sync: this.sync });
	}
}
