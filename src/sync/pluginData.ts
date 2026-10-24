/**
 * The plugin's data.json: its settings, the Suivi URL and the token, nothing
 * about the Client app (the app holds the sync truth). A `sync` key left by
 * an older version (bases, Pull cursor, conflicts) is dropped on load.
 */
export class PluginData<S extends object> {
	private constructor(
		readonly settings: S,
		private readonly write: (data: unknown) => Promise<void>,
	) {}

	static async load<S extends object>(
		defaults: S,
		read: () => Promise<unknown>,
		write: (data: unknown) => Promise<void>,
	): Promise<PluginData<S>> {
		const { sync: _dropped, ...settings } = ((await read()) ?? {}) as Record<string, unknown>;
		return new PluginData(Object.assign({}, defaults, settings) as S, write);
	}

	private queue: Promise<unknown> = Promise.resolve();

	/** Runs `job` after the previous ones settle, so a Pull, a Push and a conflict pick never run at once. */
	exclusive<T>(job: () => Promise<T>): Promise<T> {
		const run = this.queue.then(job, job);
		this.queue = run.catch(() => undefined);
		return run;
	}

	save(): Promise<void> {
		return this.write({ ...this.settings });
	}
}
