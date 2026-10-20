import { obsidianTransport } from "./obsidianTransport";
import { createHttpRemote, type Remote } from "./remote";

/** A Remote that reads the Suivi URL and token from the settings at each call (they may change while it lives). */
export function settingsRemote(settings: { suiviUrl: string; suiviToken: string }): Remote {
	return createHttpRemote(
		{
			get url() {
				return settings.suiviUrl;
			},
			get token() {
				return settings.suiviToken;
			},
		},
		obsidianTransport,
	);
}

/** Listeners of a store's state: `emit` to all, `subscribe` returns the unsubscribe. */
export function listeners<T>() {
	const all = new Set<(state: T) => void>();
	return {
		emit: (state: T) => all.forEach((l) => l(state)),
		subscribe: (listener: (state: T) => void) => {
			all.add(listener);
			return () => {
				all.delete(listener);
			};
		},
	};
}
