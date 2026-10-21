import { splitBlockId } from "../blockId";
import type { SyncState } from "../sync/pluginData";
import type { VaultFiles } from "../sync/runPull";

/**
 * Where an app item lives in the vault: the file it was last pushed from and,
 * for a Task, its line found by block ID (0 for a Project note). Null when the
 * item isn't from this vault, its line is gone, or the entry carries no item.
 */
export async function itemLocation(
	sync: SyncState,
	files: VaultFiles,
	item: { kind: "project" | "task" | "review"; id: string } | undefined,
): Promise<{ path: string; line: number } | null> {
	if (!item) return null;
	if (item.kind === "project") {
		const pushed = sync.pushedProjects[item.id];
		return pushed ? { path: pushed.path, line: 0 } : null;
	}
	if (item.kind === "review") {
		const pushed = sync.pushedReviews?.[item.id];
		return pushed ? { path: pushed.path, line: 0 } : null;
	}
	const pushed = sync.pushedTasks[item.id];
	if (!pushed) return null;
	const content = await files.read(pushed.path);
	if (content === null) return null;
	const line = content.split("\n").findIndex((l) => splitBlockId(l).blockId === item.id);
	return line < 0 ? null : { path: pushed.path, line };
}
