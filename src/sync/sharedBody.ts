/** Image types Suivi accepts (`UPLOAD_TYPES` of the API), by file extension. */
export const IMAGE_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

const extension = (link: string) => link.slice(link.lastIndexOf(".") + 1).toLowerCase();

/** `![[target|size]]`, `[[target#heading|alias]]`. */
const WIKI = /(!?)\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g;

/**
 * A Task body as Suivi gets it: embedded vault images are
 * uploaded (once each) and linked as `![](<url>)`; other embeds and wikilinks
 * become plain text, so the Client never sees a broken link. Code blocks and
 * inline code are kept as written. `upload` gets the embed's link text and
 * returns the app URL; it throws if the image can't be found or sent.
 */
export async function shareBody(body: string, upload: (link: string) => Promise<string>): Promise<string> {
	const urls = new Map<string, Promise<string>>();
	const uploadOnce = (link: string) => {
		let url = urls.get(link);
		if (!url) {
			url = upload(link);
			urls.set(link, url);
		}
		return url;
	};

	return rewriteOutsideCode(body, (text) => rewrite(text, uploadOnce));
}

/**
 * `body` with `rewriteText` applied to the text outside fenced code blocks
 * and inline code, which are kept as written.
 */
export async function rewriteOutsideCode(body: string, rewriteText: (text: string) => Promise<string>): Promise<string> {
	const out: string[] = [];
	let fenced = false;
	for (const line of body.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		if (fenced || /^\s*(```|~~~)/.test(line)) {
			out.push(line);
			continue;
		}
		// Odd pieces are inline code.
		const pieces = line.split(/(`[^`]*`)/);
		for (let i = 0; i < pieces.length; i += 2) pieces[i] = await rewriteText(pieces[i]!);
		out.push(pieces.join(""));
	}
	return out.join("\n");
}

async function rewrite(text: string, upload: (link: string) => Promise<string>): Promise<string> {
	const parts: string[] = [];
	let last = 0;
	for (const m of text.matchAll(WIKI)) {
		parts.push(text.slice(last, m.index));
		last = m.index! + m[0].length;
		const [, bang, target = "", heading, alias] = m;
		const name = target.trim();
		if (bang && IMAGE_TYPES[extension(name)]) {
			parts.push(`![](${await upload(name)})`);
		} else if (!bang && alias?.trim()) {
			parts.push(alias.trim());
		} else {
			const section = heading?.trim() && !heading.trim().startsWith("^") ? ` > ${heading.trim()}` : "";
			parts.push(`${name}${section}`);
		}
	}
	parts.push(text.slice(last));
	return parts.join("");
}
