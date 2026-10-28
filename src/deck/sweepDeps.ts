import type { App } from "obsidian";
import { dailyNotesOptions } from "../dailyNote";
import type { Remote } from "../remote/remote";
import type { ProjectsTimerSettings } from "../settings";
import { fetchAppItems, type AppItems } from "../sync/appState";
import { planPush } from "../sync/planPush";
import { projectOfLink, type ProjectOfLink } from "../sync/projectLink";
import { readVault } from "../sync/readVault";
import { bodySharer } from "../sync/bodySharer";
import { runPush, vaultWriters, type PushOutcome } from "../sync/runPush";
import type { VaultFiles } from "../sync/runPull";
import { projectRules } from "../sync/taskProject";
import { vaultFiles } from "../sync/vaultFiles";
import type { SweepNote, SweepOptions } from "./sweep";
import { pushSwept, type SweptLine } from "./sweepRun";

/** What the Deck's Sweep needs of the vault and the Push. */
export interface SweepDeps {
	options: SweepOptions;
	/** The notes of the Daily Notes folder, with their creation time. */
	notes(): Promise<SweepNote[]>;
	files: Pick<VaultFiles, "read" | "process">;
	/** How the links of note `sourcePath` find their Project note. */
	projectOf(sourcePath: string): ProjectOfLink;
	/** The Push closing a session: the changes of the lines the Sweep wrote only, without the review; null when there were none. */
	push(lines: SweptLine[]): Promise<PushOutcome | null>;
}

/**
 * The Sweep on this vault: the core Daily Notes folder and format, the sweep
 * age setting, the Project rule of the Push. Null without a projects
 * location, as the Push refuses to run then.
 */
export function obsidianSweep(app: App, settings: ProjectsTimerSettings, remote: Remote): SweepDeps | null {
	if (!settings.projectsLocation) return null;
	const daily = dailyNotesOptions(app);
	const rules = projectRules(app, settings);
	const files = vaultFiles(app);
	return {
		options: { folder: daily.folder, format: daily.format, age: settings.sweepAge, isProject: rules.isProject },
		async notes() {
			const prefix = daily.folder ? `${daily.folder}/` : "";
			const inFolder = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
			return Promise.all(
				inFolder.map(async (f) => ({ path: f.path, basename: f.basename, content: await app.vault.cachedRead(f), ctime: f.stat.ctime })),
			);
		},
		files,
		projectOf: (sourcePath) => projectOfLink(rules, sourcePath),
		push(lines) {
			let state: AppItems;
			return pushSwept(lines, {
				async plan() {
					state = await fetchAppItems(remote);
					return planPush(await readVault(app, settings), state, new Date());
				},
				push: (selected) => runPush(selected, { remote, app: state, ...vaultWriters(files), shareBody: bodySharer(app, remote) }),
			});
		},
	};
}
