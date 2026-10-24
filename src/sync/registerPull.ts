import { Notice, Plugin } from "obsidian";
import { obsidianTransport } from "../remote/obsidianTransport";
import { createHttpRemote, RemoteError } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import type { PluginData } from "./pluginData";
import { readVault } from "./readVault";
import { runPull, type PullOutcome } from "./runPull";
import { vaultFiles } from "./vaultFiles";

const PULL_EVERY_MS = 5 * 60_000;

/**
 * Pulls Client changes from Suivi on startup, every 5 minutes and with the
 * "Pull from Suivi" command, then hands the outcome (conflicts, app state) to
 * `afterPull`. Automatic Pulls stay quiet unless something happened (a write,
 * a conflict not seen at the previous Pull); the command always reports.
 */
export function registerPull(
	plugin: Plugin,
	data: PluginData<ProjectsTimerSettings>,
	afterPull: (outcome: PullOutcome) => void = () => {},
) {
	let known = new Set<string>();
	async function pull(manual: boolean) {
		const { suiviUrl, suiviToken } = data.settings;
		if (!manual && (!suiviUrl || !suiviToken)) return;
		const remote = createHttpRemote({ url: suiviUrl, token: suiviToken }, obsidianTransport);
		try {
			const outcome = await data.exclusive(async () =>
				runPull({ remote, files: vaultFiles(plugin.app), vault: await readVault(plugin.app, data.settings) }),
			);
			for (const f of outcome.failed) new Notice(`Pull: ${f.title}: ${f.error}`, 10_000);
			const keys = new Set(outcome.conflicts.map((c) => c.key));
			const fresh = [...keys].filter((key) => !known.has(key)).length;
			known = keys;
			if (keys.size > 0 && (manual || fresh > 0)) {
				new Notice(`Pull: ${keys.size} conflict(s) with your unpushed edits; pick in the Suivi inbox or Push to Suivi.`, 10_000);
			}
			if (manual || outcome.applied > 0) new Notice(`Pulled ${outcome.applied} change(s) from Suivi.`);
			afterPull(outcome);
		} catch (e) {
			// An automatic Pull with the app down shouldn't nag every 5 minutes.
			if (manual || !(e instanceof RemoteError && e.kind === "network")) {
				new Notice(e instanceof RemoteError ? e.message : `Pull failed: ${(e as Error).message}`, 10_000);
			}
		}
	}

	plugin.app.workspace.onLayoutReady(() => void pull(false));
	plugin.registerInterval(window.setInterval(() => void pull(false), PULL_EVERY_MS));
	plugin.addCommand({ id: "pull-from-suivi", name: "Pull from Suivi", callback: () => void pull(true) });
}
