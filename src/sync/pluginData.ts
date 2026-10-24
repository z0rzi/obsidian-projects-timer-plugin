import type { ApiEvent } from "../remote/api";
import type { PullConflict } from "./pullPriority";
import type { PushedProjects } from "./pushPlan";
import type { PushedTasks } from "./taskPlan";

/** What the plugin keeps about the Client app besides the notes. */
export interface SyncState {
	/**
	 * Base of each non-archived Project in the app, by id, as the last Pull or
	 * Push fetched it (`fetchAppItems`). Memory only: the app holds the bases.
	 */
	pushedProjects: PushedProjects;
	/** Same for Tasks, by app id (= block ID). */
	pushedTasks: PushedTasks;
	/** Id of the last app event handled by the Pull (`GET /api/events?since=`); unset = never pulled. */
	cursor?: number;
	/** Pulled events whose item is in no note right now, retried at each Pull (oldest first). */
	pullRetry?: ApiEvent[];
	/** Client changes not applied because the vault changed the same field, by `<id>:<field>`. */
	conflicts?: Record<string, PullConflict>;
}

/** The base of the Project or Task `id`. */
export function pushedItem(
	sync: SyncState,
	kind: "project" | "task",
	id: string,
): PushedProjects[string] | PushedTasks[string] | undefined {
	return kind === "project" ? sync.pushedProjects[id] : sync.pushedTasks[id];
}

const emptySync = (): SyncState => ({ pushedProjects: {}, pushedTasks: {} });

/** The keys data.json keeps; anything else (bases, state of removed features) is dropped on load. */
const SAVED_KEYS: Record<Exclude<keyof SyncState, "pushedProjects" | "pushedTasks">, true> = {
	cursor: true,
	pullRetry: true,
	conflicts: true,
};

/** The saved part of `sync`. */
function savedSync(sync: object): Partial<SyncState> {
	return Object.fromEntries(Object.entries(sync).filter(([key]) => key in SAVED_KEYS)) as Partial<SyncState>;
}

function readSync(raw: unknown): SyncState {
	return { ...emptySync(), ...savedSync((raw ?? {}) as object) };
}

/**
 * The plugin's data.json: settings at the top level (as before) plus the
 * saved sync state under `sync`. Both are always written together by `save()`, so
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

	/** Forgets everything about the Client app (in memory; `save()` to persist). */
	clearSync(): void {
		for (const key of Object.keys(this.sync)) delete this.sync[key as keyof SyncState];
		Object.assign(this.sync, emptySync());
	}

	save(): Promise<void> {
		return this.write({ ...this.settings, sync: savedSync(this.sync) });
	}
}
