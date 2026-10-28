/**
 * A next-tick scheduler for a view (a `Component`): `run` goes on the next tick (or after `ms`), unless the view
 * unloads first. One cleanup is registered for every tick still pending; a tick that has run is dropped.
 */
export function tickUnlessUnloaded(owner: { register(cb: () => void): void }): (run: () => void, ms?: number) => void {
	const pending = new Set<ReturnType<typeof setTimeout>>();
	owner.register(() => {
		for (const timer of pending) clearTimeout(timer);
		pending.clear();
	});
	return (run, ms = 0) => {
		const timer = setTimeout(() => {
			pending.delete(timer);
			run();
		}, ms);
		pending.add(timer);
	};
}
