import type { ApiEvent, EventType } from "../remote/api";
import type { PullHandler } from "../sync/runPull";

/** Event types that may change the Inbox. */
export const INBOX_EVENT_TYPES: EventType[] = ["comment.created", "item.updated", "ticket.created", "review.answered"];

/**
 * The Pull handlers plus a call to `notice` for each event that may change
 * the Inbox, so it reloads from the app only when needed. Existing handlers
 * still run; types without one get a no-op.
 */
export function withInboxNotice(
	handlers: Partial<Record<EventType, PullHandler>>,
	notice: (event: ApiEvent) => void,
): Partial<Record<EventType, PullHandler>> {
	const result = { ...handlers };
	for (const type of INBOX_EVENT_TYPES) {
		const inner = handlers[type];
		result[type] = async (event, ctx) => {
			notice(event);
			await inner?.(event, ctx);
		};
	}
	return result;
}
