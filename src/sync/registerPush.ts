import { Notice, parseLinktext, Plugin, type App } from "obsidian";
import { UPLOAD_MAX_BYTES } from "../remote/api";
import { obsidianTransport } from "../remote/obsidianTransport";
import { createHttpRemote, RemoteError, type Remote } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import { PushModal } from "../ui/PushModal";
import type { PluginData } from "./pluginData";
import { fetchAppItems, type AppItems } from "./appState";
import type { Conflict } from "./compareState";
import { planPush } from "./planPush";
import { readVault } from "./readVault";
import { vaultFiles } from "./vaultFiles";
import { runPush, vaultWriters } from "./runPush";
import { IMAGE_TYPES, shareBody } from "./sharedBody";

/**
 * Adds the "Push to Suivi" command: fetches the app's state, lists the
 * vault's changes against it, then sends the ticked ones. A conflict's
 * buttons go to `pick`, which settles it at once.
 */
export function registerPush(
	plugin: Plugin,
	data: PluginData<ProjectsTimerSettings>,
	pick: (conflict: Conflict, choice: "mine" | "theirs") => Promise<boolean>,
) {
	const { app } = plugin;
	const files = vaultFiles(app);

	async function push() {
		if (!data.settings.projectsLocation) {
			new Notice("Set the projects location in the plugin settings before pushing.");
			return;
		}
		const remote = createHttpRemote(
			{ url: data.settings.suiviUrl, token: data.settings.suiviToken },
			obsidianTransport,
		);
		const vault = await readVault(app, data.settings);
		for (const message of vault.skipped) new Notice(message);
		let pending;
		let appItems: AppItems;
		try {
			appItems = await data.exclusive(() => fetchAppItems(remote));
			pending = planPush(vault, appItems, new Date());
		} catch (e) {
			new Notice(e instanceof RemoteError ? e.message : `Push failed: ${(e as Error).message}`, 10_000);
			return;
		}
		new PushModal(app, appHost(data.settings.suiviUrl), pending, pick, async (selected) => {
			try {
				const outcome = await data.exclusive(() => runPush(selected, {
					remote,
					app: appItems,
					...vaultWriters(files),
					shareBody: bodySharer(app, remote),
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
