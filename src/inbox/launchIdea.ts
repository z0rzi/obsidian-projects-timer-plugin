import type { ProjectFields } from "../remote/api";
import type { Remote } from "../remote/remote";
import { readSharedProject } from "../sync/sharedProject";
import { type LocalTask, readTagTasks } from "../sync/sharedTask";
import { noteProject, projectOfLink, type ProjectRules } from "../sync/projectLink";
import { indentedBodyEnd } from "../taskParser";
import { projectFile, projectPath, type NewProjectDeps } from "./newProject";

export interface LaunchIdeaDeps extends Pick<NewProjectDeps, "folder" | "template" | "exists" | "create"> {
	remote: Pick<Remote, "launch">;
	/** Rewrites the note at `path` (the line's removal). */
	process(path: string, edit: (content: string) => string): Promise<void>;
	/** The body as the app gets it, as the Push shares it (images uploaded); the vault text when absent. */
	shareBody?(path: string, body: string): Promise<string>;
	/** How the Push resolves Project links, to read the line as it does (a bare `[[Project]]` body line is no description). */
	projects: ProjectRules;
}

/** The Tag tasks of `note` as the Push reads them, with the same Project links. */
function tagTasks(path: string, content: string, rules: ProjectRules): LocalTask[] {
	return readTagTasks(path, content, noteProject(rules, path, content), projectOfLink(rules, path));
}

export type LaunchIdeaResult = { ok: true; path: string } | { ok: false; error: string };

const NOT_AN_IDEA = "Placez le curseur sur une ligne #idea.";

/**
 * « Lancer en projet » on the `#idea` line `line` of `note` (ADR 0009): its Project note is made from the
 * template with the line's Suivi id, title, Priority and body as description (the Project-note creator of
 * « Insérer ici »), the app makes the Idea that Project, same id, with the note's fields and their vault form
 * as the base (so the next Push sees no change), then the note is created and the line and its body leave
 * `note`. The app is called before anything is written: a refusal leaves the vault as it was.
 */
export async function runLaunchIdea(note: { path: string; content: string }, line: number, deps: LaunchIdeaDeps): Promise<LaunchIdeaResult> {
	const idea = tagTasks(note.path, note.content, deps.projects).find((t) => t.line === line);
	if (!idea || idea.type !== "idea" || idea.done) return { ok: false, error: NOT_AN_IDEA };
	const id = idea.blockId;
	if (!id) return { ok: false, error: "Cette idée n'est pas encore dans l'app : poussez-la d'abord." };
	// A line always has a Priority (no token: P1); `pq` is a `#quick`'s only.
	const priority = idea.priority === "pq" ? null : idea.priority;
	const at = projectPath(idea.title, deps);
	if ("error" in at) return { ok: false, error: at.error };

	const fields: ProjectFields = { title: idea.title, description: idea.description, priority, done: false, due_date: null };
	const content = projectFile(await deps.template(), at.name, id, fields);
	// The base is the note as the Push will read it back.
	const read = readSharedProject(at.path, content);
	if (!read?.ok) return { ok: false, error: `${at.path} : note de Projet illisible.` };
	const base = read.project.fields;
	try {
		const description = deps.shareBody && base.description ? await deps.shareBody(note.path, base.description) : base.description;
		await deps.remote.launch(id, { fields: { ...base, description }, base: { path: at.path, fields: base } });
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	await deps.create(at.path, content);
	let removed = false;
	await deps.process(note.path, (text) => {
		const lines = text.split("\n");
		const now = tagTasks(note.path, text, deps.projects).find((t) => t.blockId === id && t.type === "idea");
		if (!now) return text;
		removed = true;
		lines.splice(now.line, indentedBodyEnd(lines, now.line) - now.line + 1);
		return lines.join("\n");
	});
	if (!removed) return { ok: false, error: `${at.path} créé, mais la ligne #idea n'a pas été retrouvée dans ${note.path}.` };
	return { ok: true, path: at.path };
}
