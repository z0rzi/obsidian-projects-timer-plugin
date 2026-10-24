import type { ItemState, ProjectFields, StateAnswer, TaskFields, TaskStateFields } from "../remote/api";
import type { Remote } from "../remote/remote";
import { dueMonthOf } from "../dueDate";

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
	/** Handle of whoever set the current Échéance on the site. */
	dueDateBy: string | null;
}

export interface AppTask extends AppItem {
	base: Base<TaskFields>;
	current: TaskStateFields;
}

/** The app's Items as the Push plans against them, by id. */
export interface AppItems {
	projects: Record<string, AppProject>;
	tasks: Record<string, AppTask>;
	/** Ids of the Items the app holds a base for (pushed or triaged before). */
	withBase: Set<string>;
}

/**
 * The state of `GET /api/state` by id. An Item without a base takes its
 * current fields as its base (path unknown: ""); a Task's then may hold
 * values only the app sets (`amelioration`), which the Push simply replaces.
 */
export function appItems(items: ItemState[]): AppItems {
	const out: AppItems = { projects: {}, tasks: {}, withBase: new Set(items.filter((i) => i.base !== null).map((i) => i.id)) };
	for (const item of items) {
		const common = { archived: item.archived, triaged: item.triaged, answer: item.answer, priorityBy: item.priority_by };
		if (item.kind === "project") {
			const current = withDueDate(item.fields);
			const stored = item.base as Base<ProjectFields> | null;
			const base = stored ? { ...stored, fields: baseFields(stored.fields) } : { path: "", fields: current };
			out.projects[item.id] = { base, current, ...common, dueDateBy: item.due_date_by ?? null };
		} else {
			const base = (item.base as Base<TaskFields> | null) ?? { path: "", fields: item.fields as TaskFields };
			out.tasks[item.id] = { base, current: item.fields, ...common };
		}
	}
	return out;
}

/** Project fields with `due_date` null when absent: a Base written (or an app) from before the Échéance has none. */
function withDueDate(fields: ProjectFields): ProjectFields {
	return { ...fields, due_date: fields.due_date ?? null };
}

/** A stored Base's fields: `due_date` null when absent, and a day (written before the Échéance was a month) read as its month. */
function baseFields(fields: ProjectFields): ProjectFields {
	const { due_date } = withDueDate(fields);
	return { ...fields, due_date: due_date === null ? null : dueMonthOf(due_date) };
}

/** Fetches the app's state (`GET /api/state`) by id. */
export async function fetchAppItems(remote: Pick<Remote, "state">): Promise<AppItems> {
	return appItems(await remote.state());
}
