import type { PushChange, TaskFields } from "../remote/api";
import type { LineRef } from "../lineWriter";
import type { LocalTask } from "./sharedTask";

/** Last-pushed state of each Task, by app id (= its block ID). */
export type PushedTasks = Record<string, { path: string; fields: TaskFields }>;

/**
 * How Tasks reach their Project, by Project note path. No `id` = a Project
 * pushed for the first time in this Push. `hidden` = prive, or archived and
 * never pushed: its Tasks stay in the vault. `unreadable` = its file couldn't
 * be read this time: its Tasks are left as they are in the app.
 */
export type ProjectLinks = Record<string, { id?: string; title: string; hidden?: boolean; unreadable?: boolean }>;

/** A field change as shown in the Push modal. */
export interface TaskDiff {
	field: "title" | "type" | "status" | "priority" | "project" | "done" | "description";
	from: string;
	to: string;
}

/** One Task line of the Push modal; `change` is what goes to the app if it stays ticked. */
export type PendingTaskChange =
	| {
			group: "new";
			key: string;
			path: string;
			/** Where to write the block ID the app gives. */
			ref: LineRef;
			title: string;
			fields: TaskFields;
			/** Path of a Project created in the same Push: its id goes into `project_id` once known. */
			needsProject?: string;
			detail: string;
			change: Extract<PushChange, { kind: "task"; op: "create" }>;
	  }
	| {
			group: "changed";
			key: string;
			id: string;
			path: string;
			title: string;
			/** All shared fields now, recorded as last-pushed once applied. */
			fields: TaskFields;
			needsProject?: string;
			diffs: TaskDiff[];
			change: Extract<PushChange, { kind: "task"; op: "update" }>;
	  }
	| { group: "deleted"; key: string; id: string; title: string; change: Extract<PushChange, { kind: "task"; op: "archive" }> };

const DONE_OFFERED_MS = 30 * 24 * 60 * 60_000;
const FIELDS = ["title", "type", "status", "priority", "project_id", "done_on", "description"] as const;

const TYPE_LABELS: Record<string, string> = {
	task: "Tâche",
	bug: "Bug",
	quick: "Tâche rapide",
	wait: "En attente",
	step: "Étape de projet",
};
const STATUS_LABELS: Record<string, string> = {
	a_faire: "À faire",
	en_cours: "En cours",
	a_valider: "À valider",
	termine: "Terminé",
};

/**
 * Compares the vault's Task lines with what was last pushed. A line with a
 * block ID is the app item of that id wherever it now lives (a moved line is
 * a change, not delete + create); a pushed id no longer found is offered as
 * an archive. Lines never pushed and done more than 30 days ago stay in the
 * vault; done lines without a date are left out at the first Push (their
 * keys come back in `history`) and offered afterwards unless in `doneHistory`.
 */
export function planTaskPush(
	local: LocalTask[],
	projects: ProjectLinks,
	pushed: PushedTasks,
	opts: { now: Date; doneHistory?: string[] },
): { changes: PendingTaskChange[]; history: string[] } {
	const changes: PendingTaskChange[] = [];
	const history: string[] = [];
	const seen = new Set<string>();
	const titleOf = (id: string | null) => {
		if (id === null) return "none";
		return Object.values(projects).find((p) => p.id === id)?.title ?? id;
	};
	const keptProjects = new Set(Object.values(projects).flatMap((p) => (p.unreadable && p.id ? [p.id] : [])));

	for (const t of local) {
		const link = t.projectPath ? projects[t.projectPath] : undefined;
		if (link?.hidden || link?.unreadable) continue;
		const needsProject = link && !link.id ? t.projectPath! : undefined;

		if (t.blockId) {
			if (seen.has(t.blockId)) continue; // a copied line keeps the id: the first one wins
			seen.add(t.blockId);
		}
		// Snapshots recorded before bodies were shared have no description: read it as empty.
		const stored = t.blockId ? pushed[t.blockId]?.fields : undefined;
		const before = stored ? { ...stored, description: stored.description ?? "" } : undefined;
		const fields: TaskFields = {
			title: t.title,
			type: t.type ?? before?.type ?? "task",
			status: t.status,
			priority: t.priority,
			project_id: link?.id ?? null,
			...(t.status === "termine" ? { done_on: t.doneOn ?? null } : {}),
			description: t.description,
		};

		if (!t.blockId) {
			if (t.status === "termine") {
				if (t.doneOn) {
					if (opts.now.getTime() - Date.parse(`${t.doneOn}T00:00:00Z`) > DONE_OFFERED_MS) continue;
				} else {
					const key = `${t.path}\n${t.raw}`;
					if (!opts.doneHistory) {
						history.push(key);
						continue;
					}
					if (opts.doneHistory.includes(key)) continue;
				}
			}
			const project = needsProject ? link!.title : titleOf(fields.project_id);
			changes.push({
				group: "new",
				key: `new-task:${t.path}:${t.line}`,
				path: t.path,
				ref: { line: t.line, raw: t.raw },
				title: t.title,
				fields,
				...(needsProject ? { needsProject } : {}),
				detail: [TYPE_LABELS[fields.type], show("status", fields), project === "none" ? "" : project]
					.filter(Boolean)
					.join(" · "),
				change: { op: "create", kind: "task", fields },
			});
			continue;
		}

		const diffs: TaskDiff[] = [];
		const sent: Partial<TaskFields> = {};
		for (const field of FIELDS) {
			// Reopening clears the done date in the app; no need to send it.
			if (field === "done_on" && fields.status !== "termine") continue;
			const from = before?.[field] ?? null;
			const to = fields[field] ?? null;
			const projectPending = field === "project_id" && needsProject;
			if (before && from === to && !projectPending) continue;
			Object.assign(sent, { [field]: to });
			if (field === "project_id") {
				const shown = needsProject ? link!.title : titleOf(fields.project_id);
				diffs.push({ field: "project", from: before ? titleOf(before.project_id) : "?", to: shown });
			} else {
				diffs.push({ field: LABEL[field], from: before ? show(field, before) : "?", to: show(field, fields) });
			}
		}
		if (diffs.length === 0) continue;
		changes.push({
			group: "changed",
			key: `changed-task:${t.blockId}`,
			id: t.blockId,
			path: t.path,
			title: t.title,
			fields,
			...(needsProject ? { needsProject } : {}),
			diffs,
			change: { op: "update", kind: "task", id: t.blockId, fields: sent },
		});
	}

	for (const [id, last] of Object.entries(pushed)) {
		if (seen.has(id)) continue;
		if (last.fields.project_id && keptProjects.has(last.fields.project_id)) continue;
		changes.push({
			group: "deleted",
			key: `deleted-task:${id}`,
			id,
			title: last.fields.title,
			change: { op: "archive", kind: "task", id },
		});
	}
	return { changes, history };
}

const LABEL = {
	title: "title",
	type: "type",
	status: "status",
	priority: "priority",
	project_id: "project",
	done_on: "done",
	description: "description",
} as const satisfies Record<(typeof FIELDS)[number], TaskDiff["field"]>;

function show(field: (typeof FIELDS)[number], f: TaskFields): string {
	switch (field) {
		case "type":
			return TYPE_LABELS[f.type] ?? f.type;
		case "status":
			return STATUS_LABELS[f.status] ?? f.status;
		case "priority":
			return f.priority === null ? "(none)" : `P${f.priority}`;
		case "done_on":
			return f.done_on ?? "(Push date)";
		case "description":
			return f.description.split("\n")[0]?.trim() || "(vide)";
		default:
			return String(f[field] ?? "");
	}
}
