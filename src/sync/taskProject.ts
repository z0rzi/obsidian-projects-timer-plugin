import type { App } from "obsidian";
import type { ProjectsTimerSettings } from "../settings";
import type { ProjectRules } from "./projectLink";

/**
 * The Push's rule for Project links, as Obsidian resolves them: a Project note
 * sits directly in the projects folder (not in a subfolder) and is not the
 * Project template.
 */
export function projectRules(app: App, settings: Pick<ProjectsTimerSettings, "projectsLocation" | "projectTemplate">): ProjectRules {
	const folder = settings.projectsLocation.replace(/\/+$/, "");
	return {
		links: app.metadataCache,
		isProject: (path) => path !== settings.projectTemplate && path.slice(0, Math.max(0, path.lastIndexOf("/"))) === folder,
	};
}
