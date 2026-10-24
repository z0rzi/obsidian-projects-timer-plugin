import type { VaultFiles } from "./runPull";
import { readSharedProject, type SharedProject } from "./sharedProject";
import { readProjectSteps, readTagTasks, type LocalTask } from "./sharedTask";

/** No note of the vault carries the item. */
export class NotInVault extends Error {}

type Finder<T> = (path: string, content: string) => T | null;

/**
 * Finds an item by its app id: in `lastPath` (the note of its base) first,
 * then in any other note that mentions the id (a line moved, a note renamed).
 * Throws NotInVault if it is nowhere.
 */
export async function locateItem<T>(
	files: VaultFiles,
	id: string,
	lastPath: string,
	find: Finder<T>,
): Promise<{ path: string; found: T }> {
	const content = await files.read(lastPath);
	const hit = content === null ? null : find(lastPath, content);
	if (hit) return { path: lastPath, found: hit };
	for (const path of files.paths()) {
		if (path === lastPath) continue;
		const other = await files.read(path);
		if (other === null || !other.includes(id)) continue;
		const found = find(path, other);
		if (found) return { path, found };
	}
	throw new NotInVault("not in the vault");
}

/** The Task line with block ID `id`: a Tag task or a Project step. */
export const taskLine =
	(id: string): Finder<LocalTask> =>
	(path, content) =>
		[...readTagTasks(path, content, null), ...readProjectSteps(path, content)].find((t) => t.blockId === id) ?? null;

/** The Project note with `suivi_id: <id>`. */
export const projectNote =
	(id: string): Finder<SharedProject> =>
	(path, content) => {
		const result = readSharedProject(path, content);
		return result?.ok && result.project.suiviId === id ? result.project : null;
	};
