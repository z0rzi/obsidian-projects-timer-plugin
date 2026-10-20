import type { PushChange, ReviewAnswer, ReviewFields } from "../remote/api";
import type { LocalReview } from "./sharedReview";
import type { ProjectLinks } from "./taskPlan";

/**
 * Last-pushed state of each Review, by app id. `fields.body` is the body as
 * written in the vault (before images are uploaded), so edits show as changes.
 * `answer` is the Client's last answer, as the Pull saw it.
 */
export type PushedReviews = Record<string, { path: string; fields: ReviewFields; answer?: ReviewAnswer }>;

/** A Review note with its `project:` resolved to a note path (null: missing or unresolved). */
export type PlannedReview = LocalReview & { projectPath: string | null };

/** A field change as shown in the Push modal. */
export interface ReviewDiff {
	field: "title" | "body" | "project" | "task";
	from: string;
	to: string;
}

/** One Review line of the Push modal; `change` is what goes to the app (body uploaded first). */
export type PendingReviewChange =
	| {
			group: "new";
			key: string;
			path: string;
			title: string;
			fields: ReviewFields;
			/** Path of a Project created in the same Push: its id goes into `project_id` once known. */
			needsProject?: string;
			detail: string;
			change: Extract<PushChange, { kind: "review"; op: "create" }>;
	  }
	| {
			group: "changed";
			key: string;
			id: string;
			path: string;
			title: string;
			fields: ReviewFields;
			needsProject?: string;
			diffs: ReviewDiff[];
			change: Extract<PushChange, { kind: "review"; op: "update" }>;
	  }
	| { group: "deleted"; key: string; id: string; title: string; change: Extract<PushChange, { kind: "review"; op: "archive" }> };

const FIELDS = ["title", "body", "project_id", "task_id"] as const;
const LABEL = { title: "title", body: "body", project_id: "project", task_id: "task" } as const;

/**
 * Compares the Review notes with what was last pushed. A Review needs a
 * shared Project: one without `project:`, or whose Project is prive or not
 * readable, is left out with a problem to show. A pushed Review whose note
 * is gone is offered as an archive.
 */
export function planReviewPush(
	local: PlannedReview[],
	projects: ProjectLinks,
	pushed: PushedReviews,
): { changes: PendingReviewChange[]; problems: { path: string; error: string }[] } {
	const changes: PendingReviewChange[] = [];
	const problems: { path: string; error: string }[] = [];
	const seen = new Set<string>();
	const titleOf = (id: string) => Object.values(projects).find((p) => p.id === id)?.title ?? id;

	for (const r of local) {
		if (r.suiviId) {
			if (seen.has(r.suiviId)) continue; // a copied note keeps the id: the first one wins
			seen.add(r.suiviId);
		}
		const link = r.projectPath ? projects[r.projectPath] : undefined;
		if (!link || link.hidden || link.unreadable) {
			const why = !r.projectLink
				? "no project: in its frontmatter"
				: !link
					? `its project ${r.projectLink} is not a Project note`
					: link.hidden
						? `its Project ${link.title} is not shared`
						: `its Project ${link.title} could not be read`;
			problems.push({ path: r.path, error: why });
			continue;
		}
		const needsProject = link.id ? undefined : r.projectPath!;
		const fields: ReviewFields = { title: r.title, body: r.body, project_id: link.id ?? "", task_id: r.taskId };

		if (!r.suiviId) {
			changes.push({
				group: "new",
				key: `new-review:${r.path}`,
				path: r.path,
				title: r.title,
				fields,
				...(needsProject ? { needsProject } : {}),
				detail: ["Review", link.title, r.taskId ? `Task ^${r.taskId} → À valider` : ""].filter(Boolean).join(" · "),
				change: { op: "create", kind: "review", fields },
			});
			continue;
		}

		const before = pushed[r.suiviId]?.fields;
		const diffs: ReviewDiff[] = [];
		const sent: Partial<ReviewFields> = {};
		for (const field of FIELDS) {
			const from = before?.[field] ?? null;
			const to = fields[field];
			const projectPending = field === "project_id" && needsProject;
			if (before && from === to && !projectPending) continue;
			Object.assign(sent, { [field]: to });
			diffs.push({
				field: LABEL[field],
				from: before ? show(field, from, titleOf) : "?",
				to: field === "project_id" ? link.title : show(field, to, titleOf),
			});
		}
		if (diffs.length === 0) continue;
		changes.push({
			group: "changed",
			key: `changed-review:${r.suiviId}`,
			id: r.suiviId,
			path: r.path,
			title: r.title,
			fields,
			...(needsProject ? { needsProject } : {}),
			diffs,
			change: { op: "update", kind: "review", id: r.suiviId, fields: sent },
		});
	}

	for (const [id, last] of Object.entries(pushed)) {
		if (seen.has(id)) continue;
		changes.push({
			group: "deleted",
			key: `deleted-review:${id}`,
			id,
			title: last.fields.title,
			change: { op: "archive", kind: "review", id },
		});
	}
	return { changes, problems };
}

function show(field: (typeof FIELDS)[number], value: string | null, titleOf: (id: string) => string): string {
	if (value === null) return "(none)";
	if (field === "project_id") return titleOf(value);
	if (field === "task_id") return `^${value}`;
	if (field === "body") {
		const s = value.replace(/\s+/g, " ").trim();
		return s ? `“${s.length > 60 ? `${s.slice(0, 60)}…` : s}”` : "(empty)";
	}
	return value;
}
