import type { App } from "obsidian";
import type { VaultFiles } from "./runPull";

/** The vault's notes as the sync code sees them (reads and atomic edits by path). */
export function vaultFiles(app: App): VaultFiles {
	const { vault } = app;
	return {
		async read(path) {
			const file = vault.getFileByPath(path);
			return file ? vault.read(file) : null;
		},
		async process(path, edit) {
			const file = vault.getFileByPath(path);
			if (!file) throw new Error(`${path} not found`);
			await vault.process(file, edit);
		},
		paths: () => vault.getMarkdownFiles().map((f) => f.path),
	};
}
