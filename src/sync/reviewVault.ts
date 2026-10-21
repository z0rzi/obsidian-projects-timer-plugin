import { parseLinktext, type App } from "obsidian";
import { processLineById, setTaskToken, type StatusToken } from "../lineWriter";
import { UPLOAD_MAX_BYTES } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { SyncState } from "./pluginData";
import type { PlannedReview } from "./reviewPlan";
import { IMAGE_TYPES, shareReviewBody } from "./reviewBody";
import { uploadImage } from "./sharedImages";
import { readReview } from "./sharedReview";
import { vaultFiles } from "./vaultFiles";

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

/** `shareBody` of a Push: vault images found from the note, uploaded to Suivi (once: see `uploadImage`). */
export function reviewBodySharer(app: App, remote: Remote, sync: SyncState) {
	return (path: string, body: string) =>
		shareReviewBody(body, async (link) => {
			const target = app.metadataCache.getFirstLinkpathDest(parseLinktext(link).path, path);
			if (!target) throw new Error(`image ${link} not found in the vault`);
			if (!IMAGE_TYPES[target.extension.toLowerCase()]) throw new Error(`${link} is not a PNG, JPEG, GIF or WebP image`);
			const data = await app.vault.readBinary(target);
			if (data.byteLength > UPLOAD_MAX_BYTES) throw new Error(`image ${link} is over 10 MB`);
			return uploadImage(sync, { path: target.path, name: target.name, data }, (d, name) => remote.upload(d, name));
		});
}

/** `writeTaskToken` of a Push: the token of the line `^id` in `path`. */
export async function writeTaskTokenIn(app: App, path: string, id: string, token: StatusToken): Promise<void> {
	await processLineById(vaultFiles(app).process, path, id, (content, ref) => setTaskToken(content, ref, token));
}
