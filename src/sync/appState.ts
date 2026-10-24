import type { ItemState, ProjectFields, TaskFields, TaskStateFields } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { SyncState } from "./pluginData";

/**
 * An Item's base as the plugin writes it (`ItemBase` on the wire): its shared
 * fields as the vault last agreed with the app, and the note they were read from.
 */
export type Base<F> = {
	path: string;
	fields: F;
};

export interface AppProject {
	base: Base<ProjectFields>;
	current: ProjectFields;
	archived: boolean;
}

export interface AppTask {
	base: Base<TaskFields>;
	current: TaskStateFields;
	archived: boolean;
}

/** The app's Items as the Push plans against them, by id. */
export interface AppItems {
	projects: Record<string, AppProject>;
	tasks: Record<string, AppTask>;
	/** The app holds a base for some Item: this vault pushed or triaged before. */
	hasBases: boolean;
}

/**
 * The state of `GET /api/state` by id. An Item without a base takes its
 * current fields as its base (path unknown: ""); a Task's then may hold
 * values only the app sets (`amelioration`), which the Push simply replaces.
 */
export function appItems(items: ItemState[]): AppItems {
	const out: AppItems = { projects: {}, tasks: {}, hasBases: items.some((i) => i.base !== null) };
	for (const item of items) {
		if (item.kind === "project") {
			const base = (item.base as Base<ProjectFields> | null) ?? { path: "", fields: item.fields };
			out.projects[item.id] = { base, current: item.fields, archived: item.archived };
		} else {
			const base = (item.base as Base<TaskFields> | null) ?? { path: "", fields: item.fields as TaskFields };
			out.tasks[item.id] = { base, current: item.fields, archived: item.archived };
		}
	}
	return out;
}

/**
 * Fetches the app's state and keeps the bases of its non-archived Items in
 * `sync.pushedProjects` / `pushedTasks` (memory only) for the Pull, conflicts
 * and the Inbox, which still read them there.
 */
export async function fetchAppItems(remote: Pick<Remote, "state">, sync: SyncState): Promise<AppItems> {
	const app = appItems(await remote.state());
	sync.pushedProjects = {};
	sync.pushedTasks = {};
	for (const [id, p] of Object.entries(app.projects)) if (!p.archived) sync.pushedProjects[id] = p.base;
	for (const [id, t] of Object.entries(app.tasks)) if (!t.archived) sync.pushedTasks[id] = t.base;
	return app;
}
