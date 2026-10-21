import type { SyncState } from "./pluginData";

/** A vault image to share: its path, file name and content. */
export interface VaultImage {
	path: string;
	name: string;
	data: ArrayBuffer;
}

/**
 * The app URL of a vault image: the one recorded in `sync.appImages` when the
 * file still has the recorded size, else a fresh upload, then recorded.
 */
export async function uploadImage(
	sync: SyncState,
	image: VaultImage,
	upload: (data: ArrayBuffer, name: string) => Promise<string>,
): Promise<string> {
	const known = sync.appImages?.[image.path];
	if (known && known.bytes === image.data.byteLength) return known.url;
	const url = await upload(image.data, image.name);
	(sync.appImages ??= {})[image.path] = { url, bytes: image.data.byteLength };
	return url;
}
