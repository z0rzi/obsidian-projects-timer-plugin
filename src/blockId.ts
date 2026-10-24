const BLOCK_ID = /\s\^([A-Za-z0-9-]+)\s*$/;

/** Splits a trailing Obsidian block ID (`^id`) off a line or title. */
export function splitBlockId(text: string): { text: string; blockId?: string } {
	const match = text.match(BLOCK_ID);
	if (!match) return { text };
	return { text: text.slice(0, match.index).trimEnd(), blockId: match[1]! };
}

/** An id as the Client app makes them: 5 characters, `a-z0-9`. */
export const APP_ID = /^[a-z0-9]{5}$/;

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A new id in the app's format, for an Item the Push creates. */
export function newAppId(random: () => number = Math.random): string {
	return Array.from({ length: 5 }, () => ID_CHARS[Math.floor(random() * ID_CHARS.length)]).join("");
}
