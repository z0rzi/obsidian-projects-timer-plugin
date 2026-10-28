import { parseLinktext, type App } from "obsidian";
import { UPLOAD_MAX_BYTES } from "../remote/api";
import type { Remote } from "../remote/remote";
import { IMAGE_TYPES, shareBody } from "./sharedBody";

/** `shareBody` of a Push: vault images found from the note, uploaded to Suivi (which answers an image it has with its URL). */
export function bodySharer(app: App, remote: Remote) {
	return (path: string, body: string) =>
		shareBody(body, async (link) => {
			const target = app.metadataCache.getFirstLinkpathDest(parseLinktext(link).path, path);
			if (!target) throw new Error(`image ${link} not found in the vault`);
			if (!IMAGE_TYPES[target.extension.toLowerCase()]) throw new Error(`${link} is not a PNG, JPEG, GIF or WebP image`);
			const data = await app.vault.readBinary(target);
			if (data.byteLength > UPLOAD_MAX_BYTES) throw new Error(`image ${link} is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
			return remote.upload(data, target.name);
		});
}
