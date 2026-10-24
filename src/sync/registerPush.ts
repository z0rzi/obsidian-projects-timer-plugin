import { Notice, parseLinktext, Plugin, TFile, type App } from "obsidian";
import { UPLOAD_MAX_BYTES } from "../remote/api";
import { obsidianTransport } from "../remote/obsidianTransport";
import { createHttpRemote, RemoteError, type Remote } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import { PushModal } from "../ui/PushModal";
import type { PluginData } from "./pluginData";
import { fetchAppItems } from "./appState";
import { writeRemotePriority } from "./pullPriority";
import { writeAnswer } from "./pullAnswer";
import { planPush, readPushVault, type Note } from "./planPush";
import { vaultFiles } from "./vaultFiles";
import { runPush, vaultWriters } from "./runPush";
import { tagTaskProject } from "./taskProject";
import { IMAGE_TYPES, shareBody } from "./sharedBody";

/**
 * Adds the "Push to Suivi" command: fetches the app's state, lists the
 * vault's changes against it, then sends the ticked ones. `afterPush` runs
 * once a Push ended (conflicts may be settled).
 */
export function registerPush(plugin: Plugin, data: PluginData<ProjectsTimerSettings>, afterPush?: () => void) {
	const { app } = plugin;
	const files = vaultFiles(app);

	const note = async (file: TFile): Promise<Note> => ({ path: file.path, content: await app.vault.cachedRead(file) });

	/** Project notes directly in the projects folder (notes in its subfolders are not Projects), and all other notes. */
	async function readVault() {
		const folder = data.settings.projectsLocation.replace(/\/+$/, "");
		const all = app.vault.getMarkdownFiles().filter((f) => f.path !== data.settings.projectTemplate);
		const notes = await Promise.all(all.map(note));
		const projectNotes = notes.filter((_, i) => all[i]!.parent?.path === folder);
		return readPushVault(projectNotes, notes, (n) => {
			const file = app.vault.getFileByPath(n.path);
			return file ? tagTaskProject(app, file, n.content) : null;
		});
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
		const vault = await readVault();
		for (const message of vault.skipped) new Notice(message);
		let pending;
		try {
			const appItems = await data.exclusive(() => fetchAppItems(remote, data.sync));
			pending = planPush(vault, appItems, data.sync, new Date());
		} catch (e) {
			new Notice(e instanceof RemoteError ? e.message : `Push failed: ${(e as Error).message}`, 10_000);
			return;
		}
		new PushModal(app, appHost(data.settings.suiviUrl), pending, async (selected) => {
			try {
				const outcome = await data.exclusive(() => runPush(selected, {
					remote,
					sync: data.sync,
					save: () => data.save(),
					...vaultWriters(files),
					writePriority: (kind, id, path, priority) =>
						writeRemotePriority(files, kind, id, path, priority),
					writeAnswer: (write) => writeAnswer(files, write),
					shareBody: bodySharer(app, remote),
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

/** The app's host (`edf-suivi.mbz-dev.com`, `localhost:3000`), shown so the dev and real vaults can't be confused. */
function appHost(url: string): string {
	try {
		return new URL(url.trim()).host;
	} catch {
		return url;
	}
}

/** `shareBody` of a Push: vault images found from the note, uploaded to Suivi (which answers an image it has with its URL). */
function bodySharer(app: App, remote: Remote) {
	return (path: string, body: string) =>
		shareBody(body, async (link) => {
			const target = app.metadataCache.getFirstLinkpathDest(parseLinktext(link).path, path);
			if (!target) throw new Error(`image ${link} not found in the vault`);
			if (!IMAGE_TYPES[target.extension.toLowerCase()]) throw new Error(`${link} is not a PNG, JPEG, GIF or WebP image`);
			const data = await app.vault.readBinary(target);
			if (data.byteLength > UPLOAD_MAX_BYTES) throw new Error(`image ${link} is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
			return remote.upload(data, target.name);
		});
}
