import { readSharedProject } from "../sync/sharedProject";
import { readProjectSteps, readTagTasks, type LocalTask } from "../sync/sharedTask";
import { indentedBodyEnd } from "../taskParser";

/** An item with a comment thread in the Client app. */
export interface CommentTarget {
	kind: "task" | "project";
	/** App id: the Task's block ID, or the Project's `suivi_id:`. */
	id: string;
	title: string;
}

/** The Task line or its indented body (same rule as the Description) holds `line`. */
const holdsLine = (lines: string[], t: LocalTask, line: number) =>
	t.line <= line && line <= indentedBodyEnd(lines, t.line);

/**
 * Whose thread the comment panel shows for the cursor on `line` (0-based):
 * the pushed Tag task or Project step on that line or whose indented body it
 * is in, else the note's own Project if it has been pushed. Null when nothing
 * there is in the app.
 */
export function commentTargetAt(path: string, content: string, line: number): CommentTarget | null {
	const lines = content.split("\n");
	const tagTask = readTagTasks(path, content, null).find((t) => holdsLine(lines, t, line));
	if (tagTask?.blockId) return { kind: "task", id: tagTask.blockId, title: tagTask.title };
	if (!tagTask) {
		const step = readProjectSteps(path, content).find((s) => holdsLine(lines, s, line));
		if (step?.blockId) return { kind: "task", id: step.blockId, title: step.title };
	}
	const project = readSharedProject(path, content);
	if (project?.ok && project.project.suiviId) {
		return { kind: "project", id: project.project.suiviId, title: project.project.fields.title };
	}
	return null;
}
