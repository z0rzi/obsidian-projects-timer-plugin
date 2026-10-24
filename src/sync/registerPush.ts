import { Notice, parseLinktext, Plugin, TFile, type App } from "obsidian";
import { appendBlockId, processLine, processLineById, setStepDone, type LineRef } from "../lineWriter";
import { UPLOAD_MAX_BYTES } from "../remote/api";
import { obsidianTransport } from "../remote/obsidianTransport";
import { createHttpRemote, RemoteError, type Remote } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import { PushModal } from "../ui/PushModal";
import type { PluginData, SyncState } from "./pluginData";
import { settleConflicts, withConflicts } from "./conflicts";
import { writeRemotePriority } from "./pullPriority";
import { writeAnswer } from "./pullAnswer";
import { planProjectPush, type PendingChange } from "./pushPlan";
import { vaultFiles } from "./vaultFiles";
import { runPush } from "./runPush";
import { readSharedProject, type SharedProject } from "./sharedProject";
import { readProjectSteps, readTagTasks, type LocalTask } from "./sharedTask";
import { planTaskPush, type ProjectLinks } from "./taskPlan";
import { tagTaskProject } from "./taskProject";
import { IMAGE_TYPES, shareBody } from "./sharedBody";
import { uploadImage } from "./sharedImages";

/**
 * Adds the "Push to Suivi" command: lists pending Project and Task changes,
 * then send the ticked ones. `afterPush` runs once a Push ended (conflicts may be settled).
 */
export function registerPush(plugin: Plugin, data: PluginData<ProjectsTimerSettings>, afterPush?: () => void) {
	const { app } = plugin;
	const files = vaultFiles(app);

	/** Project notes directly in the projects folder (notes in its subfolders are not Projects). */
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

	async function readTasks(): Promise<LocalTask[]> {
		const tasks: LocalTask[] = [];
		for (const file of app.vault.getMarkdownFiles()) {
			if (file.path === data.settings.projectTemplate) continue;
			const content = await app.vault.cachedRead(file);
			if (!/^#\w/m.test(content)) continue;
			tasks.push(...readTagTasks(file.path, content, tagTaskProject(app, file, content)));
		}
		return tasks;
	}

	async function writeBlockId(path: string, ref: Omit<LineRef, "blockId">, id: string) {
		const result = await processLine(files.process, path, (content) => appendBlockId(content, ref, id));
		if (!result.ok) throw new Error(result.reason === "not-found" ? "the line changed" : `the line is ${result.reason}`);
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
			[
				...planProjectPush(local.projects, data.sync.pushedProjects, local.unreadable),
				...tasks.changes,
			],
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
					writeStepDate: (path, id, date) =>
						processLineById(files.process, path, id, (content, ref) => setStepDone(content, ref, date)),
					writePriority: (kind, id, path, priority) =>
						writeRemotePriority(files, kind, id, path, priority),
					writeAnswer: (write) => writeAnswer(files, write),
					shareBody: bodySharer(app, remote, data.sync),
				}));
				for (const f of outcome.failed) new Notice(`Push: ${f.title}: ${f.error}`, 10_000);
				new Notice(`Pushed ${outcome.applied} change(s) to Suivi.`);
			} catch (e) {
				new Notice(e instanceof RemoteError ? e.message : `Push failed: ${(e as Error).message}`, 10_000);
			}
			afterPush?.();
		}).open();
	}

	plugin.addCommand({ id: "push-to-suivi", name: "Push to Suivi", callback: () => void push() });
}

/** `shareBody` of a Push: vault images found from the note, uploaded to Suivi (once: see `uploadImage`). */
function bodySharer(app: App, remote: Remote, sync: SyncState) {
	return (path: string, body: string) =>
		shareBody(body, async (link) => {
			const target = app.metadataCache.getFirstLinkpathDest(parseLinktext(link).path, path);
			if (!target) throw new Error(`image ${link} not found in the vault`);
			if (!IMAGE_TYPES[target.extension.toLowerCase()]) throw new Error(`${link} is not a PNG, JPEG, GIF or WebP image`);
			const data = await app.vault.readBinary(target);
			if (data.byteLength > UPLOAD_MAX_BYTES) throw new Error(`image ${link} is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
			return uploadImage(sync, { path: target.path, name: target.name, data }, (d, name) => remote.upload(d, name));
		});
}
