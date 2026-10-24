import { STATUS_WORDS } from "../inbox/newProject";
import { localDay } from "../localDate";
import type { AcknowledgedItem, ItemAnswer, PushChange } from "../remote/api";
import type { AppItems, AppProject, AppTask, Base } from "./appState";
import type { VaultItems } from "./planPush";
import { answeredProject, answeredTask, holdsAnswer } from "./pullAnswer";
import type { SharedProject } from "./sharedProject";
import type { LocalTask } from "./sharedTask";

/** An app value the vault gets: a priority (null removes a step's token), or the Client's Answer with its local day. */
export type VaultWrite = { priority: number | null } | { answer: ItemAnswer; doneOn: string };

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
	/** A priority, or an Answer's effects (status, priority, done date) as one unit. */
	unit: "priority" | "answer";
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
 * A Task line's priority as a conflict button shows it: the line's status
 * instead when it is À valider or Terminé (no `status`: a line with a `p<n>` token).
 */
function priorityLabel(priority: number | null, status?: string): string {
	if (status === "a_valider" || status === "termine") return STATUS_WORDS[status];
	return priority === null ? "Héritée" : `P${priority}`;
}

/**
 * Compares every Item the vault carries with the app's state, for the fields
 * the site can change: priorities and Answers' effects. vault = app: the base
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
		if (item) settle(out, "task", t.blockId!, t.path, t.title, item.base, taskUnit(t, item));
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

/** A Project's priority, and its status when it comes from an Answer. */
function projectUnits(p: SharedProject, item: AppProject): Unit[] {
	const id = p.suiviId!;
	const base = item.base.fields;
	const common = { kind: "project" as const, id, path: p.path, title: p.fields.title };
	const mine = (fields: object, expected: object) => mineChange(common, base, fields, expected);
	const units: Unit[] = [];
	const answer = item.answer;
	if (answer) {
		const vault = p.fields.status;
		units.push({
			same: holdsAnswer("project", answer.answer, p.fields),
			alignNeeded: true,
			vaultAtBase: vault === base.status,
			appAtBase: false,
			pulled: { status: answeredProject(base, answer.answer).status },
			write: { answer: answer.answer, doneOn: localDay(new Date(answer.at)) },
			answer: answer.id,
			conflict: () => ({
				...common,
				key: `${id}:answer`,
				unit: "answer",
				held: ["status"],
				mine: { label: STATUS_WORDS[vault], change: mine({ status: vault }, { status: item.current.status }) },
				theirs: { label: ANSWERS[answer.answer], by: answer.by },
			}),
		});
	}
	const [vault, now, before] = [p.fields.priority, item.current.priority, base.priority];
	units.push({
		same: vault === now,
		alignNeeded: vault !== before,
		vaultAtBase: vault === before,
		appAtBase: now === before,
		pulled: { priority: now },
		write: { priority: now },
		conflict: () => ({
			...common,
			key: `${id}:priority`,
			unit: "priority",
			held: ["priority"],
			mine: { label: `P${vault}`, change: mine({ priority: vault }, { priority: now }) },
			theirs: { label: `P${now}`, by: item.priorityBy },
		}),
	});
	return units;
}

/** A Task's Answer (status, priority and done date as one unit) when its status comes from one, else its priority. */
function taskUnit(t: LocalTask, item: AppTask): Unit {
	const id = t.blockId!;
	const base = item.base.fields;
	const current = item.current;
	const common = { kind: "task" as const, id, path: t.path, title: t.title };
	const mine = (fields: object, expected: object) => mineChange(common, base, fields, expected);
	const answer = item.answer;
	if (answer) {
		const doneOn = localDay(new Date(answer.at));
		const same = holdsAnswer("task", answer.answer, t);
		const { status, priority, done_on } = answeredTask(base, answer.answer, same ? (t.doneOn ?? null) : doneOn);
		const vault = { status: t.status, priority: t.priority, ...(t.status === "termine" ? { done_on: t.doneOn ?? null } : {}) };
		return {
			same,
			alignNeeded: true,
			vaultAtBase: t.status === base.status && t.priority === base.priority,
			appAtBase: false,
			pulled: { status, priority, done_on },
			write: { answer: answer.answer, doneOn },
			answer: answer.id,
			conflict: () => ({
				...common,
				key: `${id}:answer`,
				unit: "answer",
				held: ["status", "priority", "done_on"],
				mine: {
					label: STATUS_WORDS[t.status],
					change: mine(vault, { status: current.status, priority: current.priority, ...("done_on" in vault ? { done_on: current.done_on } : {}) }),
				},
				theirs: { label: ANSWERS[answer.answer], by: answer.by },
			}),
		};
	}
	const now = current.priority;
	return {
		same: t.priority === now,
		alignNeeded: t.priority !== base.priority,
		// A vault status change counts as a vault change: writing the app's `p<n>`
		// token would overwrite that status, so it is a conflict, not a pull.
		vaultAtBase: t.priority === base.priority && t.status === base.status,
		appAtBase: now === base.priority,
		// The token written makes the line p0 = En cours, p1–p5 = À faire; when
		// vault = app, the line already holds that token, so this is its status.
		pulled: { priority: now, ...(now === null ? {} : { status: now === 0 ? "en_cours" : "a_faire" }) },
		write: { priority: now },
		conflict: () => ({
			...common,
			key: `${id}:priority`,
			unit: "priority",
			held: ["priority"],
			mine: { label: priorityLabel(t.priority, t.status), change: mine({ priority: t.priority }, { priority: now }) },
			// Both buttons show the line each choice leaves: the app's token replaces any status.
			theirs: { label: priorityLabel(now), by: item.priorityBy },
		}),
	};
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
