import type { App, TFile } from "obsidian";
import type { ProjectsTimerSettings } from "../settings";
import { readVaultItems, type Note, type VaultItems } from "./planPush";

/**
 * The vault as the Push and the Pull compare it with the app: Project notes
 * directly in the projects folder (notes in its subfolders are not Projects),
 * and the Tag tasks of every note but the Project template.
 */
export async function readVault(app: App, settings: ProjectsTimerSettings): Promise<VaultItems> {
	const note = async (file: TFile): Promise<Note> => ({ path: file.path, content: await app.vault.cachedRead(file) });
	const folder = settings.projectsLocation.replace(/\/+$/, "");
	const all = app.vault.getMarkdownFiles().filter((f) => f.path !== settings.projectTemplate);
	const notes = await Promise.all(all.map(note));
	const projectNotes = notes.filter((_, i) => all[i]!.parent?.path === folder);
	return readVaultItems(projectNotes, notes, app.metadataCache);
}
