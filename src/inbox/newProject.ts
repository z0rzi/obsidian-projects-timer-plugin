import { localDay } from "../localDate";
import type { ProjectFields, ProjectStatus } from "../remote/api";
import type { Remote } from "../remote/remote";

export interface NewProjectChoice {
	/** 0 (En cours) to 5. */
	priority: number;
}

export interface NewProjectDeps {
	remote: Pick<Remote, "triage" | "acknowledge">;
	/** Projects folder (setting), where the file goes. */
	folder: string;
	/** Content of the Project template (setting); "" when there is none. */
	template(): Promise<string>;
	exists(path: string): boolean;
	create(path: string, content: string): Promise<void>;
}

export type NewProjectResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * "Nouveau projet" on a launched Idea: the app makes the item a Project
 * first (same id, so JMJ's description and comments stay on it), then the
 * Project file is created from the template with `suivi_id:`, priority,
 * status and the Idea's description, and its base is sent to the app so the
 * next Push sees no change. Nothing is called or written if the file
 * already exists.
 */
export async function runNewProject(
	item: { id: string; title: string },
	choice: NewProjectChoice,
	deps: NewProjectDeps,
): Promise<NewProjectResult> {
	const at = projectPath(item.title, deps);
	if ("error" in at) return { ok: false, error: at.error };

	let response;
	try {
		response = await deps.remote.triage(item.id, { as: "project", priority: choice.priority });
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	if (response.as !== "project") return { ok: false, error: "The app did not make it a Project." };
	return writeProjectNote(at, item.id, response.fields, deps);
}

/**
 * « Insérer ici » on an Unplaced Project: its file is created from the
 * template with its id and the app's fields now, and its base is sent,
 * acknowledging the Answer its status comes from, as the Pull does. Nothing
 * is written if the file already exists.
 */
export function insertUnplacedProject(
	item: { id: string; fields: ProjectFields; answer?: number },
	deps: Omit<NewProjectDeps, "remote"> & { remote: Pick<Remote, "acknowledge"> },
): Promise<NewProjectResult> {
	const at = projectPath(item.fields.title, deps);
	if ("error" in at) return Promise.resolve({ ok: false, error: at.error });
	return writeProjectNote(at, item.id, item.fields, deps, item.answer);
}

/** Where the Project file of `title` goes, or why it can't. */
function projectPath(title: string, deps: Pick<NewProjectDeps, "folder" | "exists">): { path: string; name: string } | { error: string } {
	const folder = deps.folder.replace(/\/+$/, "");
	if (!folder) return { error: "Set the Projects folder in the plugin settings first." };
	const name = fileName(title);
	if (!name) return { error: "The title is not usable as a file name." };
	const path = `${folder}/${name}.md`;
	if (deps.exists(path)) return { error: `${path} already exists.` };
	return { path, name };
}

/** Creates the Project file at `at` from the template, then sends `fields` as its base, acknowledging `answer` if any. */
async function writeProjectNote(
	at: { path: string; name: string },
	id: string,
	fields: ProjectFields,
	deps: Pick<NewProjectDeps, "template" | "create"> & { remote: Pick<Remote, "acknowledge"> },
	answer?: number,
): Promise<NewProjectResult> {
	const { path } = at;
	await deps.create(path, projectFile(await deps.template(), at.name, id, fields));
	try {
		await deps.remote.acknowledge([{ id, base: { path, fields }, ...(answer !== undefined ? { answer } : {}) }]);
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `${path} created, but its base was not sent (${error})` };
	}
	return { ok: true, path };
}

/** The title as a file name: characters Obsidian refuses in names or links become spaces. */
function fileName(title: string): string {
	return title
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "");
}

/** A Project status as the vault and the Push modal write it. */
export const STATUS_WORDS: Record<ProjectStatus, string> = {
	a_faire: "À faire",
	en_cours: "En cours",
	en_pause: "En pause",
	a_valider: "À valider",
	termine: "Terminé",
};

/**
 * The template with `{{title}}`/`{{date}}` filled, `suivi_id:`, `priority:`
 * and `status:` set in its frontmatter (added if missing), and the
 * description under its `# Description` heading (added after the
 * frontmatter if missing).
 */
export function projectFile(
	template: string,
	title: string,
	id: string,
	fields: ProjectFields,
	now: Date = new Date(),
): string {
	const filled = template
		.replace(/\r\n/g, "\n")
		.replace(/\{\{title\}\}/g, title)
		.replace(/\{\{date\}\}/g, localDay(now));
	let lines = filled ? filled.split("\n") : [];
	if (lines[0]?.trim() !== "---") lines = ["---", "---", ...lines];
	let end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
	if (end < 0) end = lines.push("---") - 1;
	const keys: [string, string][] = [
		["suivi_id", id],
		["priority", String(fields.priority)],
		["status", STATUS_WORDS[fields.status]],
	];
	for (const [key, value] of keys) {
		const at = lines.findIndex((l, i) => i > 0 && i < end && new RegExp(`^${key}\\s*:`).test(l));
		if (at >= 0) lines[at] = `${key}: ${value}`;
		else lines.splice(end++, 0, `${key}: ${value}`);
	}

	const description = fields.description.trim();
	const heading = lines.findIndex((l, i) => i > end && /^#{1,3}\s+description\s*$/i.test(l));
	if (heading >= 0) {
		const after = lines[heading + 1]?.trim() === "---" ? heading + 2 : heading + 1;
		if (description) lines.splice(after, 0, description);
	} else {
		lines.splice(end + 1, 0, "", "# Description", "---", ...(description ? [description] : []));
	}
	return lines.join("\n").replace(/\n*$/, "\n");
}
