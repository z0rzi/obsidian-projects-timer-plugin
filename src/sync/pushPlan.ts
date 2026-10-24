import type { ProjectFields, PushChange } from "../remote/api";
import type { AppItems } from "./appState";
import type { PendingConflict } from "./conflicts";
import type { SharedProject } from "./sharedProject";
import type { PendingTaskChange } from "./taskPlan";

/** Base of each Project, by app id. */
export type PushedProjects = Record<string, { path: string; fields: ProjectFields }>;

export interface FieldDiff {
	field: keyof ProjectFields;
	from: string | number | null;
	to: string | number;
}

type ProjectChange = Extract<PushChange, { kind: "project" }>;

/**
 * One Project line of the Push modal; `change` is what goes to the app if it
 * stays ticked, `fields` (all shared fields now) its base once applied. A
 * `new` without `id` gets one generated and written into the note first.
 */
export type PendingProjectChange =
	| { group: "new"; key: string; id?: string; path: string; title: string; fields: ProjectFields; change: ProjectChange }
	| { group: "restored"; key: string; id: string; path: string; title: string; fields: ProjectFields; change: ProjectChange }
	| {
			group: "changed";
			key: string;
			id: string;
			path: string;
			title: string;
			fields: ProjectFields;
			diffs: FieldDiff[];
			change: ProjectChange;
	  };

/** A Project note or Task line the Push can't send until the Developer fixes it. */
export interface PushError {
	group: "error";
	key: string;
	path: string;
	title: string;
	error: string;
}

/** One line of the Push modal, Project or Task (tell them apart by `change.kind`), a Pull conflict or an error. */
export type PendingChange = PendingProjectChange | PendingTaskChange | PendingConflict | PushError;

const FIELDS = ["title", "description", "status", "priority"] as const;

/**
 * Compares the vault's shared Projects with their base in the app. Projects
 * never pushed and already archived stay vault-only. An id the app doesn't
 * know is created keeping it; one it holds archived is restored; a Task's id
 * is an error. App Projects no note carries are not offered (Unplaced).
 */
export function planProjectPush(local: SharedProject[], app: AppItems): (PendingProjectChange | PushError)[] {
	const changes: (PendingProjectChange | PushError)[] = [];
	const seen = new Set<string>();

	for (const p of local) {
		const { path, fields } = p;
		const title = fields.title;
		const id = p.suiviId;
		if (id && seen.has(id)) continue; // a copied file keeps the id: the first one wins
		if (id) seen.add(id);
		const held = id ? app.projects[id] : undefined;

		if (id && app.tasks[id]) {
			changes.push({ group: "error", key: `error:${path}`, path, title, error: `suivi_id: ${id} is a Task in Suivi; fix it in the note` });
		} else if (!id || !held) {
			if (!id && p.archived) continue;
			const change: ProjectChange = { op: "create", kind: "project", ...(id ? { id } : {}), fields };
			changes.push({ group: "new", key: `new:${path}`, ...(id ? { id } : {}), path, title, fields, change });
		} else if (held.archived) {
			const change: ProjectChange = { op: "restore", kind: "project", id, fields };
			changes.push({ group: "restored", key: `restored:${id}`, id, path, title, fields, change });
		} else {
			const diffs: FieldDiff[] = [];
			const sent: Partial<ProjectFields> = {};
			const expected: Partial<ProjectFields> = {};
			for (const field of FIELDS) {
				const from = held.base.fields[field];
				const to = fields[field];
				if (from === to) continue;
				diffs.push({ field, from, to });
				Object.assign(sent, { [field]: to });
				Object.assign(expected, { [field]: held.current[field] });
			}
			if (diffs.length === 0) continue;
			const change: ProjectChange = { op: "update", kind: "project", id, fields: sent, expected };
			changes.push({ group: "changed", key: `changed:${id}`, id, path, title, fields, diffs, change });
		}
	}
	return changes;
}
