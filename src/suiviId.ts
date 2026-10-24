import type { App } from "obsidian";

/** App id of the Project note at `path`: its `suivi_id:`, read from Obsidian's metadata cache. */
export function suiviIdOf(app: App, path: string): string | undefined {
	const file = app.vault.getFileByPath(path);
	const id: unknown = file ? app.metadataCache.getFileCache(file)?.frontmatter?.suivi_id : undefined;
	return typeof id === "string" && id ? id : undefined;
}
