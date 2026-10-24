import type { ProcessFile } from "../lineWriter";
import { setFrontmatterDueDate } from "../projectCards";
import type { Remote } from "../remote/remote";
import { fetchAppItems, type AppItems } from "./appState";
import { acknowledgements, compareState, type BaseUpdate, type Conflict, type PullWrite } from "./compareState";
import type { VaultItems } from "./planPush";
import { writeAnswer } from "./pullAnswer";
import { writeRemotePriority } from "./pullPriority";
import { unplacedItems, type UnplacedItem } from "./unplaced";

/** The few vault operations a Pull needs (an in-memory map in tests). */
export interface VaultFiles {
	/** Current content, or null if there is no such file. */
	read(path: string): Promise<string | null>;
	/** Rewrites the file atomically with `edit` (Obsidian's `vault.process`). */
	process: ProcessFile;
	/** Edits the frontmatter of the file as an object (Obsidian's `fileManager.processFrontMatter`). */
	processFrontMatter(path: string, edit: (frontmatter: Record<string, unknown>) => void): Promise<void>;
	/** Every Markdown note, to find an item that left the note it was last seen in. */
	paths(): string[];
}

export interface PullDeps {
	remote: Remote;
	files: VaultFiles;
	/** The vault as the Push reads it. */
	vault: VaultItems;
}

export interface PullOutcome {
	/** Vault writes made. */
	applied: number;
	/** The conflicts now, for the Inbox and the Push review. */
	conflicts: Conflict[];
	/** The app's Items no readable note carries, for the Inbox's « Hors du vault ». */
	unplaced: UnplacedItem[];
	/** Writes that couldn't be made (line refused, file gone): found again at the next Pull. */
	failed: { title: string; error: string }[];
	/** The app's state the Pull compared against. */
	app: AppItems;
}

/** Writes an app value into the vault: a priority, a Project's Échéance, or the Client's Answer. */
export function writePull(files: VaultFiles, pull: PullWrite): Promise<void> {
	if ("priority" in pull.write) return writeRemotePriority(files, pull.kind, pull.id, pull.path, pull.write.priority);
	if ("due_date" in pull.write) {
		const dueDate = pull.write.due_date;
		return files.process(pull.path, (content) => setFrontmatterDueDate(content, dueDate));
	}
	return writeAnswer(files, { kind: pull.kind, id: pull.id, path: pull.path, answer: pull.write.answer, doneOn: pull.write.doneOn });
}

/**
 * Fetches every Item's state and compares it with the vault (`compareState`):
 * writes the Client's changes into the vault, then acknowledges them, with the
 * bases the vault already agrees on, in one call. Nothing is kept between
 * Pulls. A whole-call failure (app down, bad token) throws a RemoteError.
 */
export async function runPull(deps: PullDeps): Promise<PullOutcome> {
	const app = await fetchAppItems(deps.remote);
	const { pulls, aligned, conflicts } = compareState(deps.vault, app);
	const outcome: PullOutcome = { applied: 0, conflicts, unplaced: unplacedItems(deps.vault, app), failed: [], app };
	const written: BaseUpdate[] = [];
	for (const pull of pulls) {
		try {
			await writePull(deps.files, pull);
			written.push(pull);
			outcome.applied++;
		} catch (e) {
			outcome.failed.push({ title: pull.title, error: (e as Error).message });
		}
	}
	const acks = acknowledgements([...aligned, ...written]);
	if (acks.length > 0) await deps.remote.acknowledge(acks);
	return outcome;
}
