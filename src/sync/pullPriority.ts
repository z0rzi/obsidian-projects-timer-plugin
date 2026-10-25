import { priorityToken, processLineById, setTaskToken } from "../lineWriter";
import { setFrontmatterKey } from "../projectCards";
import type { Priority } from "../remote/api";
import type { VaultFiles } from "./runPull";

/**
 * Writes an app priority into the vault: `priority:` frontmatter of a Project,
 * the Priority token of a Task line found by its block ID (an inheriting
 * Project step gains the token and becomes an Override; null removes it).
 */
export async function writeRemotePriority(
	files: VaultFiles,
	kind: "project" | "task",
	id: string,
	path: string,
	priority: Priority | null,
): Promise<void> {
	if (kind === "project") {
		if (priority !== null) await files.process(path, (content) => setFrontmatterKey(content, "priority", priority));
		return;
	}
	const token = priority === null ? null : priorityToken(priority);
	await processLineById(files.process, path, id, (content, ref) => setTaskToken(content, ref, token));
}
