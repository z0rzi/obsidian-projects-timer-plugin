import { EVENT_TYPES, type ApiEvent, type EventType } from "../remote/api";
import type { PullHandler } from "../sync/runPull";

/**
 * The Pull handlers plus a call to `notice` for every event pulled (any of
 * them is an entry of the Activity feed), so the Inbox reloads from the app
 * only when something came in. Existing handlers still run; types without
 * one get a no-op.
 */
export function withInboxNotice(
	handlers: Partial<Record<EventType, PullHandler>>,
	notice: (event: ApiEvent) => void,
): Partial<Record<EventType, PullHandler>> {
	const result = { ...handlers };
	for (const type of EVENT_TYPES) {
		const inner = handlers[type];
		result[type] = async (event, ctx) => {
			notice(event);
			await inner?.(event, ctx);
		};
	}
	return result;
}
