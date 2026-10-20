import type { ProjectFields, PushChange } from "../remote/api";
import type { SharedProject } from "./sharedProject";

/** Last-pushed state of each Project, by app id. */
export type PushedProjects = Record<string, { path: string; fields: ProjectFields }>;

export interface FieldDiff {
	field: keyof ProjectFields;
	/** null when this machine has no record of the pushed value. */
	from: string | number | null;
	to: string | number;
}

/** One line of the Push modal; `change` is what goes to the app if it stays ticked. */
export type PendingChange =
	| { group: "new"; key: string; path: string; title: string; fields: ProjectFields; change: PushChange }
	| {
			group: "changed";
			key: string;
			id: string;
			path: string;
			title: string;
			/** All shared fields now, recorded as last-pushed once applied. */
			fields: ProjectFields;
			diffs: FieldDiff[];
			change: PushChange;
	  }
	| { group: "deleted"; key: string; id: string; title: string; change: PushChange };

const FIELDS = ["title", "description", "status", "priority"] as const;

/**
 * Compares the vault's shared Projects with what was last pushed. Projects
 * never pushed and already archived stay vault-only; a pushed Project that
 * is no longer offered (file deleted or marked prive) is offered as an archive.
 */
export function planProjectPush(local: SharedProject[], pushed: PushedProjects): PendingChange[] {
	const changes: PendingChange[] = [];
	const seen = new Set<string>();

	for (const p of local) {
		if (!p.suiviId) {
			if (p.archived) continue;
			changes.push({
				group: "new",
				key: `new:${p.path}`,
				path: p.path,
				title: p.fields.title,
				fields: p.fields,
				change: { op: "create", kind: "project", fields: p.fields },
			});
			continue;
		}
		if (seen.has(p.suiviId)) continue; // a copied file keeps the id: the first one wins
		seen.add(p.suiviId);

		const before = pushed[p.suiviId]?.fields;
		const diffs: FieldDiff[] = [];
		const sent: Partial<ProjectFields> = {};
		for (const field of FIELDS) {
			const from = before ? before[field] : null;
			const to = p.fields[field];
			if (from === to) continue;
			diffs.push({ field, from, to });
			Object.assign(sent, { [field]: to });
		}
		if (diffs.length === 0) continue;
		changes.push({
			group: "changed",
			key: `changed:${p.suiviId}`,
			id: p.suiviId,
			path: p.path,
			title: p.fields.title,
			fields: p.fields,
			diffs,
			change: { op: "update", kind: "project", id: p.suiviId, fields: sent },
		});
	}

	for (const [id, last] of Object.entries(pushed)) {
		if (seen.has(id)) continue;
		changes.push({
			group: "deleted",
			key: `deleted:${id}`,
			id,
			title: last.fields.title,
			change: { op: "archive", kind: "project", id },
		});
	}
	return changes;
}
