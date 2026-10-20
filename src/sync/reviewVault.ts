import { parseLinktext, type App } from "obsidian";
import { setTaskToken } from "../lineWriter";
import { UPLOAD_MAX_BYTES } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { PlannedReview } from "./reviewPlan";
import { IMAGE_TYPES, shareReviewBody } from "./reviewBody";
import { readReview } from "./sharedReview";

/** Review notes of `folder` (and its subfolders), `project:` resolved to a note path. */
export async function readReviews(app: App, folder: string): Promise<PlannedReview[]> {
	const out: PlannedReview[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(`${folder}/`)) continue;
		const review = readReview(file.path, await app.vault.cachedRead(file));
		const linkpath = review.projectLink ? parseLinktext(review.projectLink).path : null;
		const target = linkpath ? app.metadataCache.getFirstLinkpathDest(linkpath, file.path) : null;
		out.push({ ...review, projectPath: target?.path ?? null });
	}
	return out;
}

/** `shareBody` of a Push: vault images found from the note, uploaded to Suivi. */
export function reviewBodySharer(app: App, remote: Remote) {
	return (path: string, body: string) =>
		shareReviewBody(body, async (link) => {
			const target = app.metadataCache.getFirstLinkpathDest(parseLinktext(link).path, path);
			if (!target) throw new Error(`image ${link} not found in the vault`);
			if (!IMAGE_TYPES[target.extension.toLowerCase()]) throw new Error(`${link} is not a PNG, JPEG, GIF or WebP image`);
			const data = await app.vault.readBinary(target);
			if (data.byteLength > UPLOAD_MAX_BYTES) throw new Error(`image ${link} is over 10 MB`);
			return remote.upload(data, target.name);
		});
}

/** `writeTaskToken` of a Push: the token of the line `^id` in `path`. */
export async function writeTaskTokenIn(app: App, path: string, id: string, token: string): Promise<void> {
	const file = app.vault.getFileByPath(path);
	if (!file) throw new Error(`${path} not found`);
	let refused: string | null = null;
	await app.vault.process(file, (content) => {
		const result = setTaskToken(content, { line: -1, raw: "", blockId: id }, token);
		if (result.ok) return result.content;
		refused = `^${id} is ${result.reason === "not-found" ? "not in the file" : result.reason}`;
		return content;
	});
	if (refused) throw new Error(refused);
}
