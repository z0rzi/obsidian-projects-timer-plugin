import { Notice, Plugin, TFile } from "obsidian";
import { obsidianTransport } from "../remote/obsidianTransport";
import { createHttpRemote, RemoteError } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import { PushModal } from "../ui/PushModal";
import type { PluginData } from "./pluginData";
import { planProjectPush } from "./pushPlan";
import { runPush } from "./runPush";
import { readSharedProject, type SharedProject } from "./sharedProject";

/** Adds the "Push to Suivi" command: review pending Project changes, then send the ticked ones. */
export function registerPush(plugin: Plugin, data: PluginData<ProjectsTimerSettings>) {
	const { app } = plugin;

	/** Project notes directly in the projects folder (subfolders such as reviews/ are not Projects). */
	function projectFiles(): TFile[] {
		const folder = data.settings.projectsLocation.replace(/\/+$/, "");
		return app.vault.getMarkdownFiles().filter((f) => f.parent?.path === folder);
	}

	async function readLocal() {
		const projects: SharedProject[] = [];
		const unreadable: string[] = [];
		for (const file of projectFiles()) {
			const result = readSharedProject(file.path, await app.vault.cachedRead(file));
			if (!result) continue;
			if (result.ok) projects.push(result.project);
			else {
				if (result.suiviId) unreadable.push(result.suiviId);
				new Notice(`Push skips ${file.basename}: ${result.error}`);
			}
		}
		return { projects, unreadable };
	}

	async function push() {
		if (!data.settings.projectsLocation) {
			new Notice("Set the projects location in the plugin settings before pushing.");
			return;
		}
		const remote = createHttpRemote(
			{ url: data.settings.suiviUrl, token: data.settings.suiviToken },
			obsidianTransport,
		);
		const local = await readLocal();
		const pending = planProjectPush(local.projects, data.sync.pushedProjects, local.unreadable);
		new PushModal(app, pending, async (selected) => {
			try {
				const outcome = await runPush(selected, {
					remote,
					sync: data.sync,
					save: () => data.save(),
					writeSuiviId: async (path, id) => {
						const file = app.vault.getFileByPath(path);
						if (!file) throw new Error("file not found");
						await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
							fm.suivi_id = id;
						});
					},
				});
				for (const f of outcome.failed) new Notice(`Push: ${f.title}: ${f.error}`, 10_000);
				new Notice(`Pushed ${outcome.applied} change(s) to Suivi.`);
			} catch (e) {
				new Notice(e instanceof RemoteError ? e.message : `Push failed: ${(e as Error).message}`, 10_000);
			}
		}).open();
	}

	plugin.addCommand({ id: "push-to-suivi", name: "Push to Suivi", callback: () => void push() });
}
