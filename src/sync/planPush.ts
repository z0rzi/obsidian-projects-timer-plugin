import type { AppItems } from "./appState";
import { compareState } from "./compareState";
import { withConflicts } from "./conflicts";
import { planProjectPush, type PendingChange } from "./pushPlan";
import { noteProject, projectOfLink, type LinkResolver, type ProjectRules } from "./projectLink";
import { readSharedProject, type SharedProject } from "./sharedProject";
import { readProjectSteps, readTagTasks, type LocalTask } from "./sharedTask";
import { planTaskPush, type ProjectLinks } from "./taskPlan";

/** A note and its content. */
export interface Note {
	path: string;
	content: string;
}

/** What the Push, the Pull and the Unplaced items read from the vault. */
export interface VaultItems {
	projects: SharedProject[];
	links: ProjectLinks;
	/** Tag tasks, then Project steps. */
	tasks: LocalTask[];
	/** Why Project notes were left out (unreadable), for a Notice each. */
	skipped: string[];
}

/**
 * Reads the shared Projects of `projectNotes` (the notes directly in the
 * projects folder), their steps, and the Tag tasks of `notes`, each linked to
 * the Project note its line, its first body line or its note names, links
 * resolved by `links` (Obsidian's resolver); none = standalone.
 */
export function readVaultItems(projectNotes: Note[], notes: Note[], links: LinkResolver): VaultItems {
	const vault: VaultItems = { projects: [], links: {}, tasks: [], skipped: [] };
	const projectPaths = new Set(projectNotes.map((n) => n.path));
	const rules: ProjectRules = { links, isProject: (path) => projectPaths.has(path) };
	const steps: LocalTask[] = [];
	for (const { path, content } of projectNotes) {
		const result = readSharedProject(path, content);
		const title = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
		if (!result) {
			vault.links[path] = { title, hidden: true };
		} else if (!result.ok) {
			vault.links[path] = { title, unreadable: true, ...(result.suiviId ? { id: result.suiviId } : {}) };
			vault.skipped.push(`Push skips ${title}: ${result.error}`);
		} else {
			const p = result.project;
			vault.projects.push(p);
			if (p.fields.done && !p.suiviId) {
				vault.links[path] = { title, doneUnsent: true };
				continue;
			}
			vault.links[path] = { title, ...(p.suiviId ? { id: p.suiviId } : {}) };
			steps.push(...readProjectSteps(path, content));
		}
	}
	for (const note of notes) {
		if (!/^#\w/m.test(note.content)) continue;
		const { path, content } = note;
		vault.tasks.push(...readTagTasks(path, content, noteProject(rules, path, content), projectOfLink(rules, path)));
	}
	vault.tasks.push(...steps);
	return vault;
}

/** The Push review: the vault's changes against the app's state, with the conflicts worked out from it. */
export function planPush(vault: VaultItems, app: AppItems, now: Date): PendingChange[] {
	return withConflicts(
		[...planProjectPush(vault.projects, app), ...planTaskPush(vault.tasks, vault.links, app, { now })],
		compareState(vault, app).conflicts,
	);
}
