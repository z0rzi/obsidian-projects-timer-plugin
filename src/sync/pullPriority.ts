import { priorityToken, processLineById, setTaskToken } from "../lineWriter";
import { setFrontmatterPriority } from "../projectCards";
import type { ApiEvent, ItemAnswer, ItemUpdatedPayload } from "../remote/api";
import type { SyncState } from "./pluginData";
import type { PullContext, VaultFiles } from "./runPull";
import { locateItem, projectNote, taskLine } from "./locateItem";

/**
 * A Client change the Pull didn't apply because the Developer had changed the
 * same field in the vault and not pushed it yet. Shown in the Push modal with
 * both values; the Developer picks. Keyed `<id>:<field>` in `SyncState.conflicts`.
 * `status` is the Client's Answer on the item
 * against a Task line whose status or priority changed locally, or a Project
 * whose status did.
 */
export interface PullConflict {
	kind: "project" | "task";
	id: string;
	field: "priority" | "status";
	/** Where the item was last pushed from. */
	path: string;
	title: string;
	/** Priority now in the app (null for a `status` conflict). */
	remote: number | null;
	/** `status` conflict: the done date the answer gives a Tag task (null for a Project step). */
	doneOn?: string | null;
	/** `status` conflict from `item.answered`: the Client's Answer (unset in older data: Validé). */
	answer?: ItemAnswer;
}

export const conflictKey = (id: string, field: string) => `${id}:${field}`;

/** `item.updated`: dispatches on the field; only priority comes from the Client today. */
export async function pullItemUpdated(event: ApiEvent, ctx: PullContext): Promise<void> {
	const payload = event.payload as Partial<ItemUpdatedPayload> & { answer?: number };
	// Part of an Answer: `item.answered` wrote the vault already.
	if (payload.answer) return;
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
	if (project) {
		const local = await locateItem(ctx.files, id, project.path, projectNote(id));
		project.path = local.path;
		const now = local.found.fields.priority;
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

	const local = await locateItem(ctx.files, id, task!.path, taskLine(id));
	task!.path = local.path;
	const line = local.found;
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

export function addConflict(sync: SyncState, key: string, conflict: PullConflict) {
	sync.conflicts = { ...sync.conflicts, [key]: conflict };
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
	if (kind === "project") {
		if (priority !== null) await files.process(path, (content) => setFrontmatterPriority(content, priority));
		return;
	}
	const token = priority === null ? null : priorityToken(priority);
	await processLineById(files.process, path, id, (content, ref) => setTaskToken(content, ref, token));
}
