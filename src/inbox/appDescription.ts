import { UPLOADED_IMAGE, withAbsoluteAppLinks } from "../comments/commentMarkdown";
import { rewriteOutsideCode } from "../sync/sharedBody";

/** What a Description from the app needs to be written into the vault. */
export interface AppDescriptionDeps {
	/** The Client app's URL (setting), that app-relative links are made absolute against. */
	appUrl: string;
	/**
	 * Copies an image the Client uploaded (`/uploads/…`) into the vault; returns
	 * its link text for `![[…]]`, or null if it failed.
	 */
	localImage?(url: string): Promise<string | null>;
}

/**
 * An app Description as the vault writes it, outside code: each app image
 * (`![alt](/uploads/…)`) copied into the vault and embedded as `![[…]]`, so
 * Obsidian shows it (a later Push uploads it again: the app answers with the
 * same URL), and every other app-relative link (a PDF, a Task) made absolute,
 * so it opens in the browser. An image that couldn't be copied keeps its
 * (absolute) app link and is counted in `missing`.
 */
export async function descriptionForVault(description: string, deps: AppDescriptionDeps): Promise<{ text: string; missing: number }> {
	let missing = 0;
	const copies = new Map<string, Promise<string | null>>();
	const text = await rewriteOutsideCode(description, async (piece) => {
		const parts: string[] = [];
		let last = 0;
		for (const m of piece.matchAll(UPLOADED_IMAGE)) {
			parts.push(piece.slice(last, m.index));
			last = m.index! + m[0].length;
			const url = m[2]!;
			if (!copies.has(url)) copies.set(url, deps.localImage ? deps.localImage(url).catch(() => null) : Promise.resolve(null));
			const link = await copies.get(url)!;
			if (link) {
				parts.push(`![[${link}]]`);
			} else {
				missing++;
				parts.push(m[0]);
			}
		}
		parts.push(piece.slice(last));
		return withAbsoluteAppLinks(parts.join(""), deps.appUrl);
	});
	return { text, missing };
}
