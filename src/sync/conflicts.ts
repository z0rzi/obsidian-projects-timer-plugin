import type { PushChange, PushedTaskStatus } from "../remote/api";
import type { SyncState } from "./pluginData";
import type { PendingChange } from "./pushPlan";
import { conflictKey, type PullConflict } from "./pullPriority";
import type { SharedProject } from "./sharedProject";
import type { LocalTask } from "./sharedTask";

/**
 * A Pull conflict in the Push modal: the vault value and Suivi's, the
 * Developer picks. `change` is what goes to the app for "mine"; "theirs"
 * writes Suivi's value into the vault instead.
 */
export interface PendingConflict {
	group: "conflict";
	key: string;
	kind: PullConflict["kind"];
	id: string;
	field: PullConflict["field"];
	/** Where the item is now in the vault. */
	path: string;
	title: string;
	/** Values ready to show. */
	local: string;
	remote: string;
	localValue: number | null;
	remoteValue: number | null;
	/** `status` conflict: the vault line's status, and the done date "theirs" writes. */
	localStatus?: string;
	doneOn?: string | null;
	choice: "mine" | "theirs";
	change: Extract<PushChange, { op: "update" }>;
}

type Local = { path: string; title: string; priority: number | null; status?: string };

function localItems(projects: SharedProject[], tasks: LocalTask[]): Map<string, Local> {
	const out = new Map<string, Local>();
	for (const p of projects) {
		if (p.suiviId) out.set(p.suiviId, { path: p.path, title: p.fields.title, priority: p.fields.priority });
	}
	for (const t of tasks) {
		if (t.blockId && !out.has(t.blockId)) {
			out.set(t.blockId, { path: t.path, title: t.title, priority: t.priority, status: t.status });
		}
	}
	return out;
}

/**
 * Drops the conflicts the vault has since resolved by itself (it now holds
 * Suivi's value), recording that value as last-pushed.
 */
export function settleConflicts(sync: SyncState, projects: SharedProject[], tasks: LocalTask[]): void {
	if (!sync.conflicts) return;
	const local = localItems(projects, tasks);
	for (const [key, c] of Object.entries(sync.conflicts)) {
		const now = local.get(c.id);
		if (!now) continue;
		if (c.field === "status") {
			if (now.status !== "termine") continue;
			const task = sync.pushedTasks[c.id];
			if (task) task.fields = { ...task.fields, status: "termine", priority: null, done_on: c.doneOn ?? null };
		} else {
			if (now.priority !== c.remote) continue;
			const pushed = c.kind === "project" ? sync.pushedProjects[c.id] : sync.pushedTasks[c.id];
			if (pushed && c.remote !== null) pushed.fields.priority = c.remote;
		}
		delete sync.conflicts[key];
	}
}

/**
 * Turns the stored Pull conflicts into Push modal entries, and takes the
 * conflicting field out of the plain "changed" entries so it is never
 * pushed without the Developer picking. A conflict whose item isn't in the
 * vault right now waits for a later Push.
 */
export function withConflicts(
	pending: PendingChange[],
	sync: SyncState,
	projects: SharedProject[],
	tasks: LocalTask[],
): PendingChange[] {
	const conflicts = Object.values(sync.conflicts ?? {});
	if (conflicts.length === 0) return pending;
	const local = localItems(projects, tasks);
	const entries: PendingConflict[] = [];
	/** The fields held out of plain changes, by item id. */
	const held = new Map<string, Set<string>>();

	for (const c of conflicts) {
		const now = local.get(c.id);
		const pushed = c.kind === "project" ? sync.pushedProjects[c.id] : sync.pushedTasks[c.id];
		if (!now || !pushed) continue;
		const fields = held.get(c.id) ?? new Set<string>();
		for (const f of HELD[c.field]) fields.add(f);
		held.set(c.id, fields);
		const status = c.field === "status";
		entries.push({
			group: "conflict",
			key: `conflict:${conflictKey(c.id, c.field)}`,
			kind: c.kind,
			id: c.id,
			field: c.field,
			path: now.path,
			title: now.title,
			local: label(now.priority, now.status),
			remote: status ? "Terminé" : label(c.remote),
			localValue: now.priority,
			remoteValue: c.remote,
			...(status ? { localStatus: now.status, doneOn: c.doneOn ?? null } : {}),
			choice: "mine",
			change:
				c.kind === "project"
					? { op: "update", kind: "project", id: c.id, fields: { priority: now.priority ?? 5 } }
					: status
						? {
								op: "update",
								kind: "task",
								id: c.id,
								fields: { status: now.status as PushedTaskStatus, priority: now.priority },
							}
						: { op: "update", kind: "task", id: c.id, fields: { priority: now.priority } },
		});
	}

	type Loose = Record<string, unknown>;
	const kept = pending.flatMap((p): PendingChange[] => {
		const fields = p.group === "changed" ? held.get(p.id) : undefined;
		if (p.group !== "changed" || !fields) return [p];
		const pushed = p.change.kind === "project" ? sync.pushedProjects[p.id] : sync.pushedTasks[p.id];
		const base = pushed!.fields as unknown as Loose;
		const sent = { ...((p.change as { fields?: Loose }).fields ?? {}) };
		// The snapshot recorded if this change is pushed keeps the held fields at their last-pushed value.
		const snapshot = { ...(p.fields as unknown as Loose) };
		for (const f of fields) {
			delete sent[f];
			if (f in base) snapshot[f] = base[f];
			else delete snapshot[f];
		}
		const diffs = p.diffs.filter((d) => !fields.has(DIFF_FIELD[d.field] ?? d.field));
		if (diffs.length === 0) return [];
		return [{ ...p, fields: snapshot, diffs, change: { ...p.change, fields: sent } } as unknown as PendingChange];
	});
	return [...kept, ...entries.sort((a, b) => a.title.localeCompare(b.title))];
}

/** Fields a conflict holds out of the plain changes until the Developer picks. */
const HELD: Record<PullConflict["field"], string[]> = {
	priority: ["priority"],
	status: ["status", "priority", "done_on"],
};

/** Task diffs show `done` for `done_on`, `project` for `project_id`. */
const DIFF_FIELD: Record<string, string> = { done: "done_on", project: "project_id" };

function label(priority: number | null, status?: string): string {
	if (status === "a_valider") return "À valider";
	if (status === "termine") return "Terminé";
	if (priority === null) return "(Project's)";
	return priority === 0 ? "P0 (En cours)" : `P${priority}`;
}
