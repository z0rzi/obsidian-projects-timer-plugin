import { locateItem, NotInVault, projectNote, taskLine } from "../sync/locateItem";
import type { VaultFiles } from "../sync/runPull";

/**
 * Where an app item lives in the vault, found by its id: the note with its
 * `suivi_id:` (line 0), or its Task line `^id`. `hint` (the note of its base)
 * is looked at first. Null when no note carries it, or the entry carries no item.
 */
export async function itemLocation(
	files: VaultFiles,
	item: { kind: "project" | "task"; id: string } | undefined,
	hint = "",
): Promise<{ path: string; line: number } | null> {
	if (!item) return null;
	try {
		if (item.kind === "project") return { path: (await locateItem(files, item.id, hint, projectNote(item.id))).path, line: 0 };
		const { path, found } = await locateItem(files, item.id, hint, taskLine(item.id));
		return { path, line: found.line };
	} catch (e) {
		if (e instanceof NotInVault) return null;
		throw e;
	}
}
