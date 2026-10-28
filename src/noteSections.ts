/** Sections of a note: the text under a heading, up to the next heading of its level or above. */

const HEADING = /^(#{1,6})\s/;

/**
 * `content` with `text` (a Task line and its body) at the end of the section
 * under `heading` (exact line, up to the next heading of its level or above):
 * after its last non-blank line, the blank lines that follow kept. Without
 * that heading, the heading and `text` are appended at the end, a blank line
 * before them.
 */
export function appendToSection(content: string, heading: string, text: string): string {
	const lines = content.split("\n");
	const start = lines.findIndex((l) => l.trim() === heading.trim());
	if (start === -1) {
		const before = content.replace(/\s+$/, "");
		return `${before ? `${before}\n\n` : ""}${heading.trim()}\n${text}\n`;
	}
	const level = lines[start]!.match(HEADING)?.[1]!.length ?? 6;
	let end = lines.findIndex((l, i) => i > start && (l.match(HEADING)?.[1]!.length ?? 7) <= level);
	if (end === -1) end = lines.length;
	let last = end - 1;
	while (last > start && !lines[last]!.trim()) last--;
	const after = lines.slice(last + 1);
	return [...lines.slice(0, last + 1), text, ...(after.length ? after : [""])].join("\n");
}
