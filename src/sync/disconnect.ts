import { APP_ID } from "../blockId";
import { parseFrontmatter } from "../projectCards";
import type { PluginData } from "./pluginData";
import type { VaultFiles } from "./runPull";
import { readProjectSteps, readTagTasks } from "./sharedTask";

/** Numbers of the Task lines of `content` ending with an app-format `^id`. */
function appTaskLines(path: string, content: string): number[] {
	return [...readTagTasks(path, content, null), ...readProjectSteps(path, content)]
		.filter((t) => t.blockId !== undefined && APP_ID.test(t.blockId))
		.map((t) => t.line);
}

const hasSuiviId = (content: string): boolean => Boolean(parseFrontmatter(content).suivi_id);

/** How many Project notes have a `suivi_id:` and how many Task lines an app-format `^id`. */
export async function countAppIds(files: VaultFiles): Promise<{ projects: number; tasks: number }> {
	let projects = 0;
	let tasks = 0;
	for (const path of files.paths()) {
		const content = await files.read(path);
		if (content === null) continue;
		if (hasSuiviId(content)) projects++;
		tasks += appTaskLines(path, content).length;
	}
	return { projects, tasks };
}

/**
 * Removes the Client app ids from the vault: `suivi_id:` from Project notes
 * and the app-format `^id` from Task lines. Other block IDs stay; notes
 * without app ids are not touched.
 */
export async function removeAppIds(files: VaultFiles): Promise<void> {
	for (const path of files.paths()) {
		const content = await files.read(path);
		if (content === null) continue;
		if (appTaskLines(path, content).length > 0) {
			await files.process(path, (current) => {
				const lines = current.split("\n");
				for (const line of appTaskLines(path, current)) {
					lines[line] = lines[line]!.replace(/\s+\^[a-z0-9]{5}\s*$/, "");
				}
				return lines.join("\n");
			});
		}
		if (hasSuiviId(content)) {
			await files.processFrontMatter(path, (fm) => {
				delete fm.suivi_id;
			});
		}
	}
}

type SuiviSettings = { suiviUrl: string; suiviToken: string };

/** The confirmation text of the Disconnect, with the real counts and the app URL. */
export function disconnectMessage(counts: { projects: number; tasks: number }, settings: SuiviSettings): string {
	const app =
		settings.suiviUrl && settings.suiviToken
			? `Nothing is deleted from the Client app at ${settings.suiviUrl}: the Client still sees everything. ` +
				"If you reconnect this vault to that app later, every Item will be created again as a duplicate."
			: "No Client app is connected; only the IDs in the notes will be removed.";
	return (
		`This removes the Client app IDs from ${counts.projects} Project notes (\`suivi_id\`) and ${counts.tasks} Task lines (\`^id\`), ` +
		`and clears the Suivi URL and token. ${app} Links to these block IDs (\`[[note#^id]]\`) will break.`
	);
}

/**
 * Disconnects the vault from the Client app: removes the app ids from the
 * notes, clears the Suivi URL, token and sync state, and saves data.json.
 * Never calls the app. Runs after any Pull or Push in progress.
 */
export function disconnect(files: VaultFiles, data: PluginData<SuiviSettings>): Promise<void> {
	return data.exclusive(async () => {
		await removeAppIds(files);
		data.settings.suiviUrl = "";
		data.settings.suiviToken = "";
		data.clearSync();
		await data.save();
	});
}
