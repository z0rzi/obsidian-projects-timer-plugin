import { readFrontmatter } from "./sharedProject";

/**
 * A Review note (reviews folder under the projects folder): frontmatter
 * `project:` (link to the Project note), optional `task:` (a Task's `^id`),
 * `suivi_id:` once pushed. The whole body after the frontmatter is shared.
 */
export interface LocalReview {
	path: string;
	/** File name. */
	title: string;
	/** Link text of `project:` (`[[ ]]` and alias removed), null if absent. */
	projectLink: string | null;
	/** App id of the Task under review. */
	taskId: string | null;
	suiviId?: string;
	/** Markdown as written in the vault (images and wikilinks rewritten only when pushed). */
	body: string;
}

/** Where Review notes live: `reviews/` in the projects folder (empty setting = none). */
export function reviewsFolder(projectsLocation: string): string | undefined {
	const base = projectsLocation.replace(/\/+$/, "");
	return base ? `${base}/reviews` : undefined;
}

export function readReview(path: string, content: string): LocalReview {
	const lines = content.split("\n");
	const fm = readFrontmatter(lines);
	const project = fm.project?.replace(/^\[\[|\]\]$/g, "").split("|")[0]!.trim();
	return {
		path,
		title: basename(path),
		projectLink: project || null,
		taskId: taskIdOf(fm.task),
		...(fm.suivi_id ? { suiviId: fm.suivi_id } : {}),
		body: lines.slice(fm.end).join("\n").trim(),
	};
}

/** `^t7f3a`, `t7f3a` or `[[Note#^t7f3a]]` → `t7f3a`. */
function taskIdOf(raw: string | undefined): string | null {
	const value = raw?.trim().replace(/^\[\[|\]\]$/g, "");
	if (!value) return null;
	const id = value.slice(value.lastIndexOf("^") + 1).trim();
	return /^[A-Za-z0-9-]+$/.test(id) ? id : null;
}

function basename(path: string): string {
	const file = path.slice(path.lastIndexOf("/") + 1);
	return file.endsWith(".md") ? file.slice(0, -3) : file;
}
