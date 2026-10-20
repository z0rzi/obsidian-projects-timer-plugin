const BLOCK_ID = /\s\^([A-Za-z0-9-]+)\s*$/;

/** Splits a trailing Obsidian block ID (`^id`) off a line or title. */
export function splitBlockId(text: string): { text: string; blockId?: string } {
	const match = text.match(BLOCK_ID);
	if (!match) return { text };
	return { text: text.slice(0, match.index).trimEnd(), blockId: match[1]! };
}
