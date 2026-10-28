import { dueDateLabel } from "../dueDate";
import { localDay } from "../localDate";
import type { AcknowledgedItem, ItemAnswer, Priority, PushChange } from "../remote/api";
import type { AppItems, AppProject, AppTask, Base } from "./appState";
import type { VaultItems } from "./planPush";
import { itemLabel } from "./itemLabel";
import { answeredProject, answeredTask, holdsAnswer, reprendrePriority } from "./pullAnswer";
import type { SharedProject } from "./sharedProject";
import type { LocalTask } from "./sharedTask";

/**
 * An app value the vault gets: a priority (null removes a step's token), a
 * Project's Échéance (null removes it), or the Client's Answer with its local day.
 */
export type VaultWrite = { priority: Priority | null } | { due_date: string | null } | { answer: ItemAnswer; doneOn: string };

/** A change of an Item's base: its fields in `patch` take the vault's value now, `answer` is the Answer acknowledged. */
export interface BaseUpdate {
	id: string;
	/** The note that carries the Item now. */
	path: string;
	base: Base<object>;
	patch: Record<string, unknown>;
	answer?: number;
}

/** An app value to write into the vault; once written, its base update records it. */
export interface PullWrite extends BaseUpdate {
	kind: "project" | "task";
	title: string;
	write: VaultWrite;
}

type UpdateChange = Extract<PushChange, { op: "update" }>;

/** A pullable field both the vault and the app changed since the base (spec section 6), settled by a pick. */
export interface Conflict {
	/** `<id>:<unit>`. */
	key: string;
	kind: "project" | "task";
	id: string;
	path: string;
	title: string;
	/** A priority, a Project's Échéance, or an Answer's effects (Priority, Done, done date) as one unit. */
	unit: "priority" | "due_date" | "answer";
	/** Fields the Push holds out of its plain changes until the Developer picks. */
	held: string[];
	/** (moi): the vault's value, pushed with the app value it expects and the base it makes. */
	mine: { label: string; change: UpdateChange };
	/** The Client's: the app's value written into the vault, then acknowledged. `by`: the Client's handle. */
	theirs: { label: string; by: string | null; pull: PullWrite };
}

export interface StateComparison {
	pulls: PullWrite[];
	/** Base updates where the vault already holds the app's value. */
	aligned: BaseUpdate[];
	conflicts: Conflict[];
}

/** One pullable unit of an Item, with the vault / app / base rules of spec section 4 already worked out. */
interface Unit {
	/** vault = app. */
	same: boolean;
	/** The base must be acknowledged even when vault = app (an Answer to clear, a base behind). */
	alignNeeded: boolean;
	vaultAtBase: boolean;
	appAtBase: boolean;
	/** The base once the vault holds the app's value (the write, or vault = app). */
	pulled: Record<string, unknown>;
	write: VaultWrite;
	answer?: number;
	conflict: () => Omit<Conflict, "theirs"> & { theirs: Omit<Conflict["theirs"], "pull"> };
}

const ANSWERS: Record<ItemAnswer, string> = { valide: "Validé", a_reprendre: "À reprendre" };

/**
 * Compares every Item the vault carries with the app's state, for the fields
 * the site can change: priorities, Échéances and Answers' effects. vault = app: the base
 * is aligned if behind; app changed alone: written into the vault; vault
 * changed alone: left to the Push; both: a conflict. App Items in no readable
 * note are left out (unreadable notes are not in `vault`).
 */
export function compareState(vault: VaultItems, app: AppItems): StateComparison {
	const out: StateComparison = { pulls: [], aligned: [], conflicts: [] };
	const seen = new Set<string>();
	/** The live, Triaged app Item of `id`, the first time the vault carries it. */
	const carried = <T extends { archived: boolean; triaged: boolean }>(id: string | undefined, items: Record<string, T>): T | undefined => {
		const item = id ? items[id] : undefined;
		if (!id || seen.has(id) || !item || item.archived || !item.triaged) return undefined;
		seen.add(id);
		return item;
	};
	for (const p of vault.projects) {
		const item = carried(p.suiviId, app.projects);
		if (item) for (const unit of projectUnits(p, item)) settle(out, "project", p.suiviId!, p.path, p.fields.title, item.base, unit);
	}
	for (const t of vault.tasks) {
		const item = carried(t.blockId, app.tasks);
		if (item) for (const unit of taskUnits(t, item)) settle(out, "task", t.blockId!, t.path, t.title, item.base, unit);
	}
	return out;
}

function settle(out: StateComparison, kind: Conflict["kind"], id: string, path: string, title: string, base: Base<object>, unit: Unit) {
	const update: BaseUpdate = { id, path, base, patch: unit.pulled, ...(unit.answer !== undefined ? { answer: unit.answer } : {}) };
	if (unit.same) {
		if (unit.alignNeeded) out.aligned.push(update);
	} else if (unit.appAtBase) {
		// The vault changed alone: the Push offers it.
	} else if (unit.vaultAtBase) {
		out.pulls.push({ ...update, kind, title, write: unit.write });
	} else {
		const c = unit.conflict();
		out.conflicts.push({ ...c, theirs: { ...c.theirs, pull: { ...update, kind, title, write: unit.write } } });
	}
}

/** (moi)'s change: the vault's `fields` pushed with the app values it expects, and the base they make. */
function mineChange(common: { kind: Conflict["kind"]; id: string; path: string }, base: object, fields: object, expected: object): UpdateChange {
	const { kind, id, path } = common;
	return { op: "update", kind, id, fields, expected, base: { path, fields: { ...base, ...fields } } };
}

/** An Échéance as a conflict button shows it. */
function dueDateChoice(dueDate: string | null): string {
	return dueDate === null ? "Aucune" : dueDateLabel(dueDate);
}

/**
 * A Project's Échéance, and its Answer's effects (Priority and Done) when its
 * Priority or Done comes from one, else its priority.
 */
function projectUnits(p: SharedProject, item: AppProject): Unit[] {
	const id = p.suiviId!;
	const base = item.base.fields;
	const common = { kind: "project" as const, id, path: p.path, title: p.fields.title };
	const mine = (fields: object, expected: object) => mineChange(common, base, fields, expected);
	const units: Unit[] = [];
	const answer = item.answer;
	const vault = { priority: p.fields.priority, done: p.fields.done };
	if (answer) {
		const { priority, done } = answeredProject(base, answer.answer);
		units.push({
			same: holdsAnswer(answer.answer, vault),
			alignNeeded: true,
			vaultAtBase: vault.priority === base.priority && vault.done === base.done,
			appAtBase: false,
			pulled: { priority, done },
			write: { answer: answer.answer, doneOn: localDay(new Date(answer.at)) },
			answer: answer.id,
			conflict: () => ({
				...common,
				key: `${id}:answer`,
				unit: "answer",
				held: ["priority", "done"],
				mine: { label: itemLabel("project", vault), change: mine(vault, { priority: item.current.priority, done: item.current.done }) },
				theirs: { label: ANSWERS[answer.answer], by: answer.by },
			}),
		});
	} else if (!vault.done && !item.current.done) {
		const [now, before] = [item.current.priority, base.priority];
		units.push({
			same: vault.priority === now,
			alignNeeded: vault.priority !== before,
			vaultAtBase: vault.priority === before,
			appAtBase: now === before,
			pulled: { priority: now },
			write: { priority: now },
			conflict: () => ({
				...common,
				key: `${id}:priority`,
				unit: "priority",
				held: ["priority"],
				mine: { label: itemLabel("project", vault), change: mine({ priority: vault.priority }, { priority: now }) },
				theirs: { label: itemLabel("project", item.current), by: item.priorityBy },
			}),
		});
	}
	const [vaultDue, nowDue, beforeDue] = [p.fields.due_date, item.current.due_date, base.due_date];
	units.push({
		same: vaultDue === nowDue,
		alignNeeded: vaultDue !== beforeDue,
		vaultAtBase: vaultDue === beforeDue,
		appAtBase: nowDue === beforeDue,
		pulled: { due_date: nowDue },
		write: { due_date: nowDue },
		conflict: () => ({
			...common,
			key: `${id}:due_date`,
			unit: "due_date",
			held: ["due_date"],
			mine: { label: dueDateChoice(vaultDue), change: mine({ due_date: vaultDue }, { due_date: nowDue }) },
			theirs: { label: dueDateChoice(nowDue), by: item.dueDateBy },
		}),
	});
	return units;
}

/**
 * A Task's Answer (Priority, Done and done date as one unit) when they come
 * from one, else its priority; none while the Task is Done in the vault or the app.
 */
function taskUnits(t: LocalTask, item: AppTask): Unit[] {
	const id = t.blockId!;
	const base = item.base.fields;
	const current = item.current;
	const common = { kind: "task" as const, id, path: t.path, title: t.title };
	const mine = (fields: object, expected: object) => mineChange(common, base, fields, expected);
	const answer = item.answer;
	if (answer) {
		const doneOn = localDay(new Date(answer.at));
		const same = holdsAnswer(answer.answer, t, reprendrePriority(base));
		const { priority, done, done_on } = answeredTask(base, answer.answer, same ? (t.doneOn ?? null) : doneOn);
		const vault = { priority: t.priority, done: t.done, ...(t.done ? { done_on: t.doneOn ?? null } : {}) };
		return [
			{
				same,
				alignNeeded: true,
				vaultAtBase: t.priority === base.priority && t.done === base.done,
				appAtBase: false,
				pulled: { priority, done, done_on },
				write: { answer: answer.answer, doneOn },
				answer: answer.id,
				conflict: () => ({
					...common,
					key: `${id}:answer`,
					unit: "answer",
					held: ["priority", "done", "done_on"],
					mine: {
						label: itemLabel("task", t),
						change: mine(vault, { priority: current.priority, done: current.done, ...("done_on" in vault ? { done_on: current.done_on } : {}) }),
					},
					theirs: { label: ANSWERS[answer.answer], by: answer.by },
				}),
			},
		];
	}
	if (t.done || current.done) return [];
	const now = current.priority;
	return [
		{
			same: t.priority === now,
			alignNeeded: t.priority !== base.priority,
			vaultAtBase: t.priority === base.priority,
			appAtBase: now === base.priority,
			pulled: { priority: now },
			write: { priority: now },
			conflict: () => ({
				...common,
				key: `${id}:priority`,
				unit: "priority",
				held: ["priority"],
				mine: { label: itemLabel("task", t), change: mine({ priority: t.priority }, { priority: now }) },
				theirs: { label: itemLabel("task", current), by: item.priorityBy },
			}),
		},
	];
}

/** The acknowledgements of `updates`: each Item's base with its patches applied, and the Answer acknowledged. */
export function acknowledgements(updates: BaseUpdate[]): AcknowledgedItem[] {
	const byId = new Map<string, AcknowledgedItem & { base: Base<object> }>();
	for (const u of updates) {
		const now = byId.get(u.id);
		const fields = { ...(now?.base.fields ?? u.base.fields), ...u.patch };
		const answer = u.answer ?? now?.answer;
		byId.set(u.id, { id: u.id, base: { path: u.path, fields }, ...(answer !== undefined ? { answer } : {}) });
	}
	return [...byId.values()];
}
