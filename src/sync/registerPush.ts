import { Notice, Plugin, TFile, parseLinktext } from "obsidian";
import { appendBlockId, type LineRef } from "../lineWriter";
import { obsidianTransport } from "../remote/obsidianTransport";
import { createHttpRemote, RemoteError } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import { PushModal } from "../ui/PushModal";
import type { PluginData } from "./pluginData";
import { settleConflicts, withConflicts } from "./conflicts";
import { writeRemotePriority } from "./pullPriority";
import { planProjectPush, type PendingChange } from "./pushPlan";
import { vaultFiles } from "./registerPull";
import { runPush } from "./runPush";
import { readSharedProject, type SharedProject } from "./sharedProject";
import { readProjectSteps, readTagTasks, type LocalTask } from "./sharedTask";
import { planTaskPush, type ProjectLinks } from "./taskPlan";

/** Adds the "Push to Suivi" command: review pending Project and Task changes, then send the ticked ones. */
export function registerPush(plugin: Plugin, data: PluginData<ProjectsTimerSettings>) {
	const { app } = plugin;

	/** Project notes directly in the projects folder (subfolders such as reviews/ are not Projects). */
	function projectFiles(): TFile[] {
		const folder = data.settings.projectsLocation.replace(/\/+$/, "");
		return app.vault.getMarkdownFiles().filter((f) => f.parent?.path === folder);
	}

	async function readProjects() {
		const projects: SharedProject[] = [];
		const unreadable: string[] = [];
		const links: ProjectLinks = {};
		const steps: LocalTask[] = [];
		for (const file of projectFiles()) {
			const content = await app.vault.cachedRead(file);
			const result = readSharedProject(file.path, content);
			const title = file.basename;
			if (!result) {
				links[file.path] = { title, hidden: true };
			} else if (!result.ok) {
				if (result.suiviId) unreadable.push(result.suiviId);
				links[file.path] = { title, unreadable: true, ...(result.suiviId ? { id: result.suiviId } : {}) };
				new Notice(`Push skips ${file.basename}: ${result.error}`);
			} else {
				const p = result.project;
				projects.push(p);
				if (p.archived && !p.suiviId) {
					links[file.path] = { title, hidden: true };
					continue;
				}
				links[file.path] = { title, ...(p.suiviId ? { id: p.suiviId } : {}) };
				steps.push(...readProjectSteps(file.path, content));
			}
		}
		return { projects, unreadable, links, steps };
	}

	/** Project of a Tag task: the `project:` frontmatter link, else the file itself if it has a `project` block. */
	function projectOf(file: TFile, content: string): string | null {
		const link = app.metadataCache.getFileCache(file)?.frontmatter?.project;
		if (typeof link === "string" && link.trim()) {
			const linkpath = parseLinktext(link.replace(/^\[\[|\]\]$/g, "").split("|")[0]!.trim()).path;
			const target = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
			if (target) return target.path;
		}
		return content.split("\n").some((l) => l.startsWith("```project")) ? file.path : null;
	}

	async function readTasks(): Promise<LocalTask[]> {
		const tasks: LocalTask[] = [];
		for (const file of app.vault.getMarkdownFiles()) {
			if (file.path === data.settings.projectTemplate) continue;
			const content = await app.vault.cachedRead(file);
			if (!/^#\w/m.test(content)) continue;
			tasks.push(...readTagTasks(file.path, content, projectOf(file, content)));
		}
		return tasks;
	}

	async function writeBlockId(path: string, ref: Omit<LineRef, "blockId">, id: string) {
		const file = app.vault.getFileByPath(path);
		if (!file) throw new Error("file not found");
		let refused: string | null = null;
		await app.vault.process(file, (content) => {
			const result = appendBlockId(content, ref, id);
			if (result.ok) return result.content;
			refused = result.reason === "not-found" ? "the line changed" : `the line is ${result.reason}`;
			return content;
		});
		if (refused) throw new Error(refused);
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
		const local = await readProjects();
		const localTasks = [...(await readTasks()), ...local.steps];
		settleConflicts(data.sync, local.projects, localTasks);
		const tasks = planTaskPush(
			localTasks,
			local.links,
			data.sync.pushedTasks,
			{ now: new Date(), doneHistory: data.sync.doneHistory },
		);
		const pending: PendingChange[] = withConflicts(
			[...planProjectPush(local.projects, data.sync.pushedProjects, local.unreadable), ...tasks.changes],
			data.sync,
			local.projects,
			localTasks,
		);
		new PushModal(app, pending, async (selected) => {
			try {
				const outcome = await data.exclusive(() => runPush(selected, {
					remote,
					sync: data.sync,
					save: () => data.save(),
					doneHistory: tasks.history,
					writeSuiviId: async (path, id) => {
						const file = app.vault.getFileByPath(path);
						if (!file) throw new Error("file not found");
						await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
							fm.suivi_id = id;
						});
					},
					writeBlockId,
					writePriority: (kind, id, path, priority) =>
						writeRemotePriority(vaultFiles(plugin), kind, id, path, priority),
				}));
				for (const f of outcome.failed) new Notice(`Push: ${f.title}: ${f.error}`, 10_000);
				new Notice(`Pushed ${outcome.applied} change(s) to Suivi.`);
			} catch (e) {
				new Notice(e instanceof RemoteError ? e.message : `Push failed: ${(e as Error).message}`, 10_000);
			}
		}).open();
	}

	plugin.addCommand({ id: "push-to-suivi", name: "Push to Suivi", callback: () => void push() });
}
