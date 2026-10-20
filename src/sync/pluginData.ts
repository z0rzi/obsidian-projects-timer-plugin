import type { PushedProjects } from "./pushPlan";

/** What the plugin remembers about the Client app between sessions (one machine only). */
export interface SyncState {
	/** Last-pushed shared fields of each Project, by app id: the base for "changed (old → new)". */
	pushedProjects: PushedProjects;
}

const emptySync = (): SyncState => ({ pushedProjects: {} });

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
			{ ...emptySync(), ...(sync as Partial<SyncState> | undefined) },
			write,
		);
	}

	save(): Promise<void> {
		return this.write({ ...this.settings, sync: this.sync });
	}
}
