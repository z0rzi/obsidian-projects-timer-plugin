import type { PushChange } from "../remote/api";
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
		if (!now || now.priority !== c.remote) continue;
		const pushed = c.kind === "project" ? sync.pushedProjects[c.id] : sync.pushedTasks[c.id];
		if (pushed && c.remote !== null) pushed.fields.priority = c.remote;
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
	const conflicting = new Set<string>();

	for (const c of conflicts) {
		const now = local.get(c.id);
		const pushed = c.kind === "project" ? sync.pushedProjects[c.id] : sync.pushedTasks[c.id];
		if (!now || !pushed) continue;
		conflicting.add(c.id);
		entries.push({
			group: "conflict",
			key: `conflict:${conflictKey(c.id, c.field)}`,
			kind: c.kind,
			id: c.id,
			field: c.field,
			path: now.path,
			title: now.title,
			local: label(now.priority, now.status),
			remote: label(c.remote),
			localValue: now.priority,
			remoteValue: c.remote,
			choice: "mine",
			change:
				c.kind === "project"
					? { op: "update", kind: "project", id: c.id, fields: { priority: now.priority ?? 5 } }
					: { op: "update", kind: "task", id: c.id, fields: { priority: now.priority } },
		});
	}

	const kept = pending.flatMap((p): PendingChange[] => {
		if (p.group !== "changed" || !conflicting.has(p.id)) return [p];
		const base = (p.change.kind === "project" ? sync.pushedProjects[p.id] : sync.pushedTasks[p.id])!.fields.priority;
		const { priority: _dropped, ...sent } = (p.change as Extract<PushChange, { op: "update" }>).fields;
		const diffs = p.diffs.filter((d) => d.field !== "priority");
		if (diffs.length === 0) return [];
		return [
			{
				...p,
				fields: { ...p.fields, priority: base },
				diffs,
				change: { ...p.change, fields: sent },
			} as PendingChange,
		];
	});
	return [...kept, ...entries.sort((a, b) => a.title.localeCompare(b.title))];
}

function label(priority: number | null, status?: string): string {
	if (status === "a_valider") return "À valider";
	if (status === "termine") return "Terminé";
	if (priority === null) return "(Project's)";
	return priority === 0 ? "P0 (En cours)" : `P${priority}`;
}
