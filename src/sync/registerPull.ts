import { Notice, Plugin } from "obsidian";
import { obsidianTransport } from "../remote/obsidianTransport";
import { createHttpRemote, RemoteError } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import { fetchAppItems } from "./appState";
import type { PluginData } from "./pluginData";
import { PULL_HANDLERS, runPull, type PullHandler } from "./runPull";
import { vaultFiles } from "./vaultFiles";
import type { EventType } from "../remote/api";

/** Lets other features see the Pull: extra handlers, and a call once each Pull ended. */
export interface PullHooks {
	handlers?: (base: Partial<Record<EventType, PullHandler>>) => Partial<Record<EventType, PullHandler>>;
	afterPull?: () => void;
}

const PULL_EVERY_MS = 5 * 60_000;

/**
 * Pulls Client changes from Suivi on startup, every 5 minutes and with the
 * "Pull from Suivi" command. Automatic Pulls stay quiet unless something
 * happened; the command always reports.
 */
export function registerPull(plugin: Plugin, data: PluginData<ProjectsTimerSettings>, hooks: PullHooks = {}) {
	const handlers = hooks.handlers ? hooks.handlers(PULL_HANDLERS) : PULL_HANDLERS;
	async function pull(manual: boolean) {
		const { suiviUrl, suiviToken } = data.settings;
		if (!manual && (!suiviUrl || !suiviToken)) return;
		const remote = createHttpRemote({ url: suiviUrl, token: suiviToken }, obsidianTransport);
		try {
			const outcome = await data.exclusive(async () => {
				// The Pull reads the bases from `sync`: fresh from the app each time.
				await fetchAppItems(remote, data.sync);
				return runPull({ remote, sync: data.sync, save: () => data.save(), files: vaultFiles(plugin.app) }, handlers);
			});
			for (const f of outcome.failed) new Notice(`Pull: ${f.title}: ${f.error}`, 10_000);
			if (outcome.conflicts > 0) {
				new Notice(`Pull: ${outcome.conflicts} conflict(s) with your unpushed edits; pick in Push to Suivi.`, 10_000);
			}
			if (manual || outcome.applied > 0) new Notice(`Pulled ${outcome.applied} change(s) from Suivi.`);
		} catch (e) {
			// An automatic Pull with the app down shouldn't nag every 5 minutes.
			if (manual || !(e instanceof RemoteError && e.kind === "network")) {
				new Notice(e instanceof RemoteError ? e.message : `Pull failed: ${(e as Error).message}`, 10_000);
			}
		}
		hooks.afterPull?.();
	}

	plugin.app.workspace.onLayoutReady(() => void pull(false));
	plugin.registerInterval(window.setInterval(() => void pull(false), PULL_EVERY_MS));
	plugin.addCommand({ id: "pull-from-suivi", name: "Pull from Suivi", callback: () => void pull(true) });
}
