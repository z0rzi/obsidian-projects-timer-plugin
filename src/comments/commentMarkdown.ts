/**
 * Comment bodies use app-relative URLs (`![](/uploads/…)`, `[…](/taches/…)`).
 * Makes markdown link and image targets starting with a single `/` absolute
 * against the app URL, so Obsidian's renderer can show them.
 */
export function withAppUrls(body: string, appUrl: string): string {
	const base = appUrl.trim().replace(/\/+$/, "");
	return body.replace(/(\]\()(\/(?!\/)[^)\s]*)/g, (_m, open: string, path: string) => `${open}${base}${path}`);
}
