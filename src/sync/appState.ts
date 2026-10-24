import type { ItemState, ProjectFields, StateAnswer, TaskFields, TaskStateFields } from "../remote/api";
import type { Remote } from "../remote/remote";

/**
 * An Item's base as the plugin writes it (`ItemBase` on the wire): its shared
 * fields as the vault last agreed with the app, and the note they were read from.
 */
export type Base<F> = {
	path: string;
	fields: F;
};

/** What the Pull and the Push read of every Item besides its fields (see `ItemState`). */
interface AppItem {
	archived: boolean;
	/** Triaged or pushed: a vault note should carry it. */
	triaged: boolean;
	/** The Answer the current status comes from, not acknowledged yet. */
	answer: StateAnswer | null;
	/** Handle of the Client whose site change set the current priority. */
	priorityBy: string | null;
}

export interface AppProject extends AppItem {
	base: Base<ProjectFields>;
	current: ProjectFields;
}

export interface AppTask extends AppItem {
	base: Base<TaskFields>;
	current: TaskStateFields;
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
		const common = { archived: item.archived, triaged: item.triaged, answer: item.answer, priorityBy: item.priority_by };
		if (item.kind === "project") {
			const base = (item.base as Base<ProjectFields> | null) ?? { path: "", fields: item.fields };
			out.projects[item.id] = { base, current: item.fields, ...common };
		} else {
			const base = (item.base as Base<TaskFields> | null) ?? { path: "", fields: item.fields as TaskFields };
			out.tasks[item.id] = { base, current: item.fields, ...common };
		}
	}
	return out;
}

/** Fetches the app's state (`GET /api/state`) by id. */
export async function fetchAppItems(remote: Pick<Remote, "state">): Promise<AppItems> {
	return appItems(await remote.state());
}
