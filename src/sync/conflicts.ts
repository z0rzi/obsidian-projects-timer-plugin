import type { ItemAnswer, ProjectStatus, PushChange, PushedTaskStatus } from "../remote/api";
import { holdsAnswer, recordAnswer } from "./pullAnswer";
import { STATUS_WORDS } from "../inbox/newProject";
import { pushedItem, type SyncState } from "./pluginData";
import type { PendingChange } from "./pushPlan";
import { conflictAnswer, conflictKey, type PullConflict } from "./pullPriority";
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
	/** `status` conflict: the vault item's status, and the done date "theirs" writes. */
	localStatus?: string;
	doneOn?: string | null;
	/** `status` conflict from `item.answered`: the Answer "theirs" writes (unset in older data: Validé). */
	answer?: ItemAnswer;
	choice: "mine" | "theirs";
	change: Extract<PushChange, { op: "update" }>;
}

type Local = { path: string; title: string; priority: number | null; status?: string };

function localItems(projects: SharedProject[], tasks: LocalTask[]): Map<string, Local> {
	const out = new Map<string, Local>();
	for (const p of projects) {
		if (p.suiviId) {
			out.set(p.suiviId, { path: p.path, title: p.fields.title, priority: p.fields.priority, status: p.fields.status });
		}
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
			const answer = conflictAnswer(c);
			if (!holdsAnswer(c.kind, answer, now)) continue;
			recordAnswer(sync, { kind: c.kind, id: c.id, answer, doneOn: c.doneOn ?? null });
		} else {
			if (now.priority !== c.remote) continue;
			const pushed = pushedItem(sync, c.kind, c.id);
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
		const pushed = pushedItem(sync, c.kind, c.id);
		if (!now || !pushed) continue;
		const fields = held.get(c.id) ?? new Set<string>();
		for (const f of c.kind === "project" ? [c.field] : HELD[c.field]) fields.add(f);
		held.set(c.id, fields);
		const status = c.field === "status";
		const projectStatus = status && c.kind === "project";
		entries.push({
			group: "conflict",
			key: `conflict:${conflictKey(c.id, c.field)}`,
			kind: c.kind,
			id: c.id,
			field: c.field,
			path: now.path,
			title: now.title,
			local: projectStatus ? STATUS_WORDS[now.status as ProjectStatus] : label(now.priority, now.status),
			remote: status ? answerLabel(c.kind, conflictAnswer(c)) : label(c.remote),
			localValue: now.priority,
			remoteValue: c.remote,
			...(status ? { localStatus: now.status, doneOn: c.doneOn ?? null } : {}),
			...(c.answer ? { answer: c.answer } : {}),
			choice: "mine",
			change: mineChange(c, now),
		});
	}

	type Loose = Record<string, unknown>;
	const kept = pending.flatMap((p): PendingChange[] => {
		const fields = p.group === "changed" ? held.get(p.id) : undefined;
		if (p.group !== "changed" || !fields) return [p];
		const pushed = pushedItem(sync, p.change.kind, p.id);
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

/** What "mine" sends: the vault value of the conflicting field (a Task's status goes with its priority). */
function mineChange(c: PullConflict, now: Local): PendingConflict["change"] {
	if (c.kind === "project") {
		const fields = c.field === "status" ? { status: now.status as ProjectStatus } : { priority: now.priority ?? 5 };
		return { op: "update", kind: "project", id: c.id, fields };
	}
	if (c.field === "status") {
		return { op: "update", kind: "task", id: c.id, fields: { status: now.status as PushedTaskStatus, priority: now.priority } };
	}
	return { op: "update", kind: "task", id: c.id, fields: { priority: now.priority } };
}

/** Suivi's side of a `status` conflict: where the Answer puts the item. */
function answerLabel(kind: PullConflict["kind"], answer: ItemAnswer): string {
	if (answer === "valide") return "Terminé";
	return kind === "project" ? "En cours" : "P0 (En cours)";
}

/** Fields a Task conflict holds out of the plain changes until the Developer picks (a Project's: the field only). */
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
