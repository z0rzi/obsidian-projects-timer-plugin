type Fetch = (path: string) => Promise<{ data: ArrayBuffer; type: string }>;

/**
 * Local copies of the app's uploaded images, for one comment panel: each is
 * fetched once with the token (`Remote.image`) and handed out as a blob URL,
 * revoked by `clear()` when the panel closes. A failed fetch is retried the
 * next time the image is asked for.
 */
export class AppImages {
	/** Fetched images: local URL by path. */
	private readonly ready = new Map<string, string>();
	private readonly loading = new Map<string, Promise<void>>();
	/** Bumped by `clear()`: a fetch started before it doesn't fill the cache. */
	private generation = 0;

	constructor(
		private readonly fetch: Fetch,
		private readonly toUrl: (blob: Blob) => string = (b) => URL.createObjectURL(b),
		private readonly revoke: (url: string) => void = (u) => URL.revokeObjectURL(u),
	) {}

	/** Local URLs of `paths`, by path; the ones that couldn't be fetched are left out. */
	async urls(paths: string[]): Promise<Map<string, string>> {
		await Promise.all(paths.map((path) => this.load(path)));
		return new Map(paths.flatMap((p) => (this.ready.has(p) ? [[p, this.ready.get(p)!] as const] : [])));
	}

	private load(path: string): Promise<void> {
		if (this.ready.has(path)) return Promise.resolve();
		let pending = this.loading.get(path);
		if (!pending) {
			const generation = this.generation;
			pending = this.fetch(path)
				.then(({ data, type }) => {
					const url = this.toUrl(new Blob([data], { type }));
					if (generation === this.generation) this.ready.set(path, url);
					else this.revoke(url);
				})
				.catch(() => undefined)
				.finally(() => {
					if (this.loading.get(path) === pending) this.loading.delete(path);
				});
			this.loading.set(path, pending);
		}
		return pending;
	}

	clear(): void {
		this.generation++;
		for (const url of this.ready.values()) this.revoke(url);
		this.ready.clear();
		this.loading.clear();
	}
}
