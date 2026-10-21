/** `![alt](/uploads/…)`: an image uploaded to the app. */
const UPLOADED_IMAGE = /!\[([^\]]*)\]\((\/uploads\/[^)\s]+)\)/g;

/** The uploaded images a comment body shows, once each, in order. */
export function uploadedImages(body: string): string[] {
	return [...new Set([...body.matchAll(UPLOADED_IMAGE)].map((m) => m[2]!))];
}

/**
 * Comment bodies use app-relative URLs (`![](/uploads/…)`, `[…](/taches/…)`).
 * Uploaded images point at their local copies in `images` (path → blob URL;
 * uploads need a session, Obsidian can't load them from the app), or show
 * their alt text when there is none. Other link targets starting with a
 * single `/` are made absolute against the app URL.
 */
export function withAppUrls(body: string, appUrl: string, images: ReadonlyMap<string, string> = new Map()): string {
	const base = appUrl.trim().replace(/\/+$/, "");
	return body
		.replace(UPLOADED_IMAGE, (_m, alt: string, path: string) => {
			const local = images.get(path);
			if (local) return `![${alt}](${local})`;
			return alt ? `*(image: ${alt})*` : "*(image)*";
		})
		.replace(/(\]\()(\/(?!\/)[^)\s]*)/g, (_m, open: string, path: string) => `${open}${base}${path}`);
}

/** Code spans and fenced blocks: a Mention is never inside them. */
const CODE = /(`+[^`]*`+)/;

/**
 * `body` with each `@handle` of `handles` (the comment's known mentions)
 * wrapped in `<span class="suivi-mention">`, as the site highlights them;
 * code, emails (`jmj@edf.fr`) and longer handles are left alone.
 */
export function highlightMentions(body: string, handles: readonly string[]): string {
	if (handles.length === 0) return body;
	const known = new Set(handles);
	return body
		.split(CODE)
		.map((part, i) =>
			// Odd parts are the code the split kept.
			i % 2 === 1
				? part
				: part.replace(/(?<![\w-])@([a-z0-9_-]+)(?![\w-])/g, (m, handle: string) =>
						known.has(handle) ? `<span class="suivi-mention">${m}</span>` : m,
					),
		)
		.join("");
}
