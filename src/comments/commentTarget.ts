import { readSharedProject } from "../sync/sharedProject";
import { readProjectSteps, readTagTasks } from "../sync/sharedTask";

/** An item with a comment thread in the Client app. */
export interface CommentTarget {
	kind: "task" | "project";
	/** App id: the Task's block ID, or the Project's `suivi_id:`. */
	id: string;
	title: string;
}

/**
 * Whose thread the comment panel shows for the cursor on `line` (0-based):
 * the pushed Tag task on that line or whose body it is in (until the first
 * blank line), else the pushed Project step on that line, else the note's
 * own Project if it has been pushed. Null when nothing there is in the app.
 */
export function commentTargetAt(path: string, content: string, line: number): CommentTarget | null {
	const lines = content.split("\n");
	const tagTask = readTagTasks(path, content, null)
		.filter((t) => t.line <= line && lines.slice(t.line, line + 1).every((l) => l.trim() !== ""))
		.at(-1);
	if (tagTask?.blockId) return { kind: "task", id: tagTask.blockId, title: tagTask.title };
	if (!tagTask) {
		const step = readProjectSteps(path, content).find((s) => s.line === line);
		if (step?.blockId) return { kind: "task", id: step.blockId, title: step.title };
	}
	const project = readSharedProject(path, content);
	if (project?.ok && project.project.suiviId) {
		return { kind: "project", id: project.project.suiviId, title: project.project.fields.title };
	}
	return null;
}
