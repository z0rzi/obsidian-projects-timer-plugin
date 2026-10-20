import { setTaskToken } from "../lineWriter";
import { setFrontmatterPriority } from "../projectCards";
import type { ApiEvent, ItemUpdatedPayload } from "../remote/api";
import type { SyncState } from "./pluginData";
import type { PullContext, VaultFiles } from "./runPull";
import { readSharedProject } from "./sharedProject";
import { readProjectSteps, readTagTasks, type LocalTask } from "./sharedTask";

/**
 * A Client change the Pull didn't apply because the Developer had changed the
 * same field in the vault and not pushed it yet. Shown in the Push modal with
 * both values; the Developer picks. Keyed `<id>:<field>` in `SyncState.conflicts`.
 */
export interface PullConflict {
	kind: "project" | "task";
	id: string;
	field: "priority";
	/** Where the item was last pushed from. */
	path: string;
	title: string;
	/** Value now in the app. */
	remote: number | null;
}

export const conflictKey = (id: string, field: string) => `${id}:${field}`;

/** `item.updated`: dispatches on the field; only priority comes from the Client today. */
export async function pullItemUpdated(event: ApiEvent, ctx: PullContext): Promise<void> {
	const payload = event.payload as Partial<ItemUpdatedPayload>;
	if (payload.field === "priority" && event.item) await pullPriority(event.item, payload.to, ctx);
}

/**
 * Applies a priority from the app. A value equal to the last-pushed one is
 * the echo of a Push (or a Client change undone): nothing to write. Else, if
 * the vault still holds the last-pushed value the new one is written and
 * becomes the last-pushed one; if the vault changed too, it's a conflict.
 */
async function pullPriority(id: string, to: unknown, ctx: PullContext): Promise<void> {
	if (to !== null && (typeof to !== "number" || !Number.isInteger(to) || to < 0 || to > 5)) return;
	const { sync } = ctx;
	const project = sync.pushedProjects[id];
	const task = sync.pushedTasks[id];
	const pushed = project ?? task;
	if (!pushed) return; // not from this vault
	const key = conflictKey(id, "priority");

	if (to === pushed.fields.priority) {
		delete sync.conflicts?.[key];
		return;
	}
	const local = project ? await localProjectPriority(ctx.files, pushed.path, id) : await localTaskLine(ctx.files, pushed.path, id);
	if (!local) throw new Error(`not found in ${pushed.path}`);

	if (project) {
		const now = (local as { priority: number }).priority;
		if (now === to) {
			project.fields.priority = to as number;
		} else if (now !== project.fields.priority) {
			addConflict(sync, key, { kind: "project", id, field: "priority", path: pushed.path, title: project.fields.title, remote: to });
			ctx.outcome.conflicts++;
			return;
		} else {
			if (to === null) return; // a Project always has a priority
			await writeRemotePriority(ctx.files, "project", id, pushed.path, to);
			project.fields.priority = to;
			ctx.outcome.applied++;
		}
		delete sync.conflicts?.[key];
		return;
	}

	const line = local as LocalTask;
	const fields = task!.fields;
	if (line.priority === to && line.status === statusOf(to)) {
		fields.priority = to;
	} else if (line.priority !== fields.priority || line.status !== fields.status) {
		addConflict(sync, key, { kind: "task", id, field: "priority", path: pushed.path, title: fields.title, remote: to });
		ctx.outcome.conflicts++;
		return;
	} else {
		await writeRemotePriority(ctx.files, "task", id, pushed.path, to);
		fields.priority = to;
		if (to !== null) fields.status = statusOf(to);
		ctx.outcome.applied++;
	}
	delete sync.conflicts?.[key];
}

function statusOf(priority: number | null) {
	return priority === 0 ? ("en_cours" as const) : ("a_faire" as const);
}

function addConflict(sync: SyncState, key: string, conflict: PullConflict) {
	sync.conflicts = { ...sync.conflicts, [key]: conflict };
}

async function localProjectPriority(files: VaultFiles, path: string, id: string) {
	const content = await files.read(path);
	const result = content === null ? null : readSharedProject(path, content);
	if (!result?.ok || result.project.suiviId !== id) return null;
	return { priority: result.project.fields.priority };
}

/** The Task line with block ID `id` in `path`: a Tag task or a Project step. */
async function localTaskLine(files: VaultFiles, path: string, id: string): Promise<LocalTask | null> {
	const content = await files.read(path);
	if (content === null) return null;
	const lines = [...readTagTasks(path, content, null), ...readProjectSteps(path, content)];
	return lines.find((t) => t.blockId === id) ?? null;
}

/**
 * Writes an app priority into the vault: `priority:` frontmatter of a Project,
 * the status token of a Task line found by its block ID (an inheriting
 * Project step gains the token and becomes an Override; null removes it).
 */
export async function writeRemotePriority(
	files: VaultFiles,
	kind: "project" | "task",
	id: string,
	path: string,
	priority: number | null,
): Promise<void> {
	let refused: string | null = null;
	await files.process(path, (content) => {
		if (kind === "project") {
			if (priority === null) return content;
			return setFrontmatterPriority(content, priority);
		}
		const result = setTaskToken(content, { line: -1, raw: "", blockId: id }, priority === null ? null : `p${priority}`);
		if (result.ok) return result.content;
		refused = `^${id} is ${result.reason === "not-found" ? "not in the file" : result.reason}`;
		return content;
	});
	if (refused) throw new Error(refused);
}
