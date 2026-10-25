import { APP_ID } from "../blockId";
import type { PushChange, TaskFields, TaskStateFields } from "../remote/api";
import type { LineRef } from "../lineWriter";
import type { AppItems } from "./appState";
import { itemLabel } from "./itemLabel";
import { sendsField, type PushError } from "./pushPlan";
import type { LocalTask } from "./sharedTask";

/**
 * How Tasks reach their Project, by Project note path. No `id` = a Project
 * pushed for the first time in this Push. `hidden` = prive, or archived and
 * never pushed: its Tasks stay in the vault. `unreadable` = its file couldn't
 * be read this time: its Tasks are left as they are in the app.
 */
export type ProjectLinks = Record<string, { id?: string; title: string; hidden?: boolean; unreadable?: boolean }>;

/** A field change as shown in the Push modal. */
export interface TaskDiff {
	field: "title" | "type" | "step" | "priority" | "done" | "project" | "date" | "description";
	from: string;
	to: string;
}

/**
 * One Task line of the Push modal; `change` is what goes to the app if it
 * stays ticked, `fields` (all shared fields now) its base once applied.
 */
export type PendingTaskChange =
	| {
			group: "new";
			key: string;
			/** The line's block ID the app doesn't know; none = one is generated and written into the line first. */
			id?: string;
			path: string;
			/** Where to write the generated block ID. */
			ref: LineRef;
			title: string;
			fields: TaskFields;
			/** Path of a Project created in the same Push: its id goes into `project_id` once known. */
			needsProject?: string;
			detail: string;
			/** A done line without a date, never pushed (« Terminées sans date »). */
			undated?: true;
			/** Starts ticked in the Push modal (absent = ticked). */
			ticked?: boolean;
			change: Extract<PushChange, { kind: "task"; op: "create" }>;
	  }
	| {
			group: "changed" | "restored";
			key: string;
			id: string;
			path: string;
			title: string;
			fields: TaskFields;
			needsProject?: string;
			/** Empty for `restored`: all fields are sent. */
			diffs: TaskDiff[];
			change: Extract<PushChange, { kind: "task"; op: "update" | "restore" }>;
	  };

const DONE_OFFERED_MS = 30 * 24 * 60 * 60_000;
const FIELDS = ["title", "type", "step", "priority", "done", "project_id", "done_on", "description"] as const;

const TYPE_LABELS: Record<string, string> = {
	task: "Tâche",
	bug: "Bug",
	quick: "Tâche rapide",
	wait: "En attente",
};

/**
 * Compares the vault's Task lines with their base in the app. A line with a
 * block ID is the app Task of that id wherever it now lives (a moved line is
 * a change); an id the app doesn't know is created keeping it, one it holds
 * archived is restored, a Project's id or a block ID not in the app's format
 * is an error. Lines never pushed and done more than 30 days ago stay in the
 * vault; done ones without a date are « Terminées sans date », ticked unless
 * the app holds no base for any Item of this vault (a first Push). App Tasks
 * no line carries are not offered (Unplaced).
 */
export function planTaskPush(
	local: LocalTask[],
	projects: ProjectLinks,
	app: AppItems,
	opts: { now: Date },
): (PendingTaskChange | PushError)[] {
	const changes: (PendingTaskChange | PushError)[] = [];
	const seen = new Set<string>();
	const vaultIds = [...local.map((t) => t.blockId), ...Object.values(projects).map((p) => p.id)];
	const firstPush = !vaultIds.some((id) => id !== undefined && app.withBase.has(id));
	const titleOf = (id: string | null) => {
		if (id === null) return "none";
		return Object.values(projects).find((p) => p.id === id)?.title ?? id;
	};

	for (const t of local) {
		const link = t.projectPath ? projects[t.projectPath] : undefined;
		if (link?.hidden || link?.unreadable) continue;
		const needsProject = link && !link.id ? t.projectPath! : undefined;
		const id = t.blockId;
		const error = (message: string) =>
			changes.push({ group: "error", key: `error:${t.path}:${t.line}`, path: t.path, title: t.title, error: message });

		if (id) {
			if (!APP_ID.test(id)) {
				error("id de bloc non reconnu");
				continue;
			}
			if (seen.has(id)) continue; // a copied line keeps the id: the first one wins
			seen.add(id);
			if (app.projects[id]) {
				error(`^${id} is a Project in Suivi; fix it in the note`);
				continue;
			}
		}
		const held = id ? app.tasks[id] : undefined;
		const before = held?.base.fields;
		const fields: TaskFields = {
			title: t.title,
			type: t.type ?? before?.type ?? "task",
			step: t.step,
			priority: t.priority,
			done: t.done,
			project_id: link?.id ?? null,
			...(t.done ? { done_on: t.doneOn ?? null } : {}),
			description: t.description,
		};

		if (!held) {
			const undated = !id && t.done && !t.doneOn;
			if (!id && t.doneOn && opts.now.getTime() - Date.parse(`${t.doneOn}T00:00:00Z`) > DONE_OFFERED_MS) continue;
			const project = needsProject ? link!.title : titleOf(fields.project_id);
			changes.push({
				group: "new",
				key: `new-task:${t.path}:${t.line}`,
				...(id ? { id } : {}),
				path: t.path,
				ref: { line: t.line, raw: t.raw },
				title: t.title,
				fields,
				...(needsProject ? { needsProject } : {}),
				detail: [TYPE_LABELS[fields.type], itemLabel("task", fields), project === "none" ? "" : project]
					.filter(Boolean)
					.join(" · "),
				...(undated ? { undated: true as const, ticked: !firstPush } : {}),
				change: { op: "create", kind: "task", ...(id ? { id } : {}), fields },
			});
			continue;
		}
		if (held.archived) {
			const change = { op: "restore" as const, kind: "task" as const, id: id!, fields };
			changes.push({ group: "restored", key: `restored-task:${id}`, id: id!, path: t.path, title: t.title, fields, ...(needsProject ? { needsProject } : {}), diffs: [], change });
			continue;
		}

		const diffs: TaskDiff[] = [];
		const sent: Partial<TaskFields> = {};
		const expected: Partial<TaskStateFields> = {};
		for (const field of FIELDS) {
			// Reopening clears the done date in the app; no need to send it.
			if (field === "done_on" && !fields.done) continue;
			const from = before?.[field] ?? null;
			const to = fields[field] ?? null;
			const projectPending = field === "project_id" && needsProject;
			if (!sendsField(field, from !== to || Boolean(projectPending), before!, fields)) continue;
			Object.assign(sent, { [field]: to });
			Object.assign(expected, { [field]: held.current[field] });
			if (from === to && !projectPending) continue;
			if (field === "project_id") {
				const shown = needsProject ? link!.title : titleOf(fields.project_id);
				diffs.push({ field: "project", from: titleOf(before!.project_id), to: shown });
			} else {
				diffs.push({ field: LABEL[field], from: show(field, before!), to: show(field, fields) });
			}
		}
		if (Object.keys(sent).length === 0) continue;
		changes.push({
			group: "changed",
			key: `changed-task:${id}`,
			id: id!,
			path: t.path,
			title: t.title,
			fields,
			...(needsProject ? { needsProject } : {}),
			diffs,
			change: { op: "update", kind: "task", id: id!, fields: sent, expected },
		});
	}
	return changes;
}

const LABEL = {
	title: "title",
	type: "type",
	step: "step",
	priority: "priority",
	done: "done",
	project_id: "project",
	done_on: "date",
	description: "description",
} as const satisfies Record<(typeof FIELDS)[number], TaskDiff["field"]>;

function show(field: (typeof FIELDS)[number], f: TaskFields): string {
	switch (field) {
		case "type":
			return TYPE_LABELS[f.type] ?? f.type;
		case "step":
			return f.step ? "oui" : "non";
		case "priority":
		case "done":
			return itemLabel("task", f);
		case "done_on":
			return f.done_on ?? "(Push date)";
		case "description":
			return f.description.split("\n")[0]?.trim() || "(vide)";
		default:
			return String(f[field] ?? "");
	}
}
