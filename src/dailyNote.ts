import { moment, normalizePath, type App } from "obsidian";

/** What Triage needs of the core Daily notes plugin's settings. */
export interface DailyNotesOptions {
	/** Folder of the Daily notes, "" for the vault's root. */
	folder: string;
	/** `moment` format of a Daily note's name. */
	format: string;
}

const DEFAULTS: DailyNotesOptions = { folder: "", format: "YYYY-MM-DD" };

/**
 * The core Daily notes plugin's folder and format, its defaults when unset
 * or off. Its options are not in Obsidian's API: read through
 * `app.internalPlugins`, as the core plugin keeps them.
 */
export function dailyNotesOptions(app: App): DailyNotesOptions {
	const internal = (app as unknown as { internalPlugins?: { getPluginById(id: string): { instance?: { options?: Partial<DailyNotesOptions> } } | null } })
		.internalPlugins;
	const options = internal?.getPluginById("daily-notes")?.instance?.options ?? {};
	return {
		folder: typeof options.folder === "string" ? options.folder.trim().replace(/\/+$/, "") : DEFAULTS.folder,
		format: typeof options.format === "string" && options.format.trim() ? options.format.trim() : DEFAULTS.format,
	};
}

/** Path of the Daily note of `day` (the bare-dated note, not the suffixed meeting notes beside it). */
export function dailyNotePath(options: DailyNotesOptions, day: Date): string {
	const name = moment(day).format(options.format);
	return normalizePath(options.folder ? `${options.folder}/${name}.md` : `${name}.md`);
}
