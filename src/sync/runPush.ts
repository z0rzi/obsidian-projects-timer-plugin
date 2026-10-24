import { newAppId } from "../blockId";
import { appendBlockId, markDone, processLine, processLineById, type LineRef } from "../lineWriter";
import { localDay } from "../localDate";
import type { ProjectStatus, PushChange, PushedTaskStatus, PushResult } from "../remote/api";
import { recordAnswer, type AnswerWrite } from "./pullAnswer";
import { RemoteError, type Remote } from "../remote/remote";
import { pushedItem, type SyncState } from "./pluginData";
import type { PendingConflict } from "./conflicts";
import { conflictAnswer } from "./pullPriority";
import type { PendingChange, PendingProjectChange } from "./pushPlan";
import type { VaultFiles } from "./runPull";
import type { PendingTaskChange } from "./taskPlan";

export interface PushDeps {
	remote: Remote;
	sync: SyncState;
	/** Persists `sync`. */
	save: () => Promise<void>;
	/** Writes `suivi_id: <id>` into the Project file's frontmatter. */
	writeSuiviId: (path: string, id: string) => Promise<void>;
	/** Ends the Task line with ` ^<id>`. */
	writeBlockId: (path: string, ref: Omit<LineRef, "blockId">, id: string) => Promise<void>;
	/** Writes the done date into the done Task line `^id`: after a step's type tag, after a Tag task's `#done`. */
	writeDoneDate: (path: string, id: string, date: string, step: boolean) => Promise<void>;
	/** Writes Suivi's priority into the vault ("take theirs" on a Pull conflict). */
	writePriority?: (kind: "project" | "task", id: string, path: string, priority: number | null) => Promise<void>;
	/** Writes the Client's Answer into the vault ("take theirs" on a conflict from `item.answered`). */
	writeAnswer?: (write: AnswerWrite) => Promise<void>;
	/** A Task body as Suivi gets it (images uploaded, wikilinks as text); throws if an image can't be sent. */
	shareBody?: (path: string, body: string) => Promise<string>;
}

/** The vault writers of a Push, on `files`. */
export function vaultWriters(files: VaultFiles): Pick<PushDeps, "writeSuiviId" | "writeBlockId" | "writeDoneDate"> {
	return {
		writeSuiviId: (path, id) =>
			files.processFrontMatter(path, (fm) => {
				fm.suivi_id = id;
			}),
		async writeBlockId(path, ref, id) {
			const result = await processLine(files.process, path, (content) => appendBlockId(content, ref, id));
			if (!result.ok) throw new Error(result.reason === "not-found" ? "the line changed" : `the line is ${result.reason}`);
		},
		writeDoneDate: (path, id, date, step) =>
			processLineById(files.process, path, id, (content, ref) => markDone(content, ref, step, date)),
	};
}

export interface PushOutcome {
	applied: number;
	failed: { title: string; error: string }[];
}

/**
 * Sends the ticked changes, each with its base (the vault's fields it
 * agrees on once applied). A new Item gets its id first: generated, written
 * into the note, then sent with the create. Projects go first, so Tasks of a
 * Project created in the same Push get its id. Pull conflicts are settled
 * last, as the Developer picked: "mine" pushes the vault value, "theirs"
 * writes Suivi's into the vault. Error lines are never sent. A change the
 * app refuses is reported. A failure of a whole call (bad token, app down)
 * throws a RemoteError; what was applied before is kept.
 */
export async function runPush(selected: PendingChange[], deps: PushDeps): Promise<PushOutcome> {
	const outcome: PushOutcome = { applied: 0, failed: [] };
	const conflicts = selected.filter((c): c is PendingConflict => c.group === "conflict");
	const items = selected.filter((c): c is PendingProjectChange | PendingTaskChange => c.group !== "conflict" && c.group !== "error");
	const projects = items.filter((c): c is PendingProjectChange => c.change.kind === "project");
	const tasks = items.filter((c): c is PendingTaskChange => c.change.kind === "task");

	const created = await pushProjects(projects, deps, outcome);

	const ready: PendingTaskChange[] = [];
	for (const t of tasks) {
		if (!t.needsProject) {
			ready.push(t);
			continue;
		}
		const projectId = created.get(t.needsProject) ?? findPushedProject(deps.sync, t.needsProject);
		if (!projectId) {
			const error = `its Project ${basename(t.needsProject)} is not in Suivi yet; push it too`;
			outcome.failed.push({ title: t.title, error });
			continue;
		}
		ready.push(withProject(t, projectId));
	}
	await pushTasks(ready, deps, outcome);
	await settleConflicts(conflicts, deps, outcome);
	return outcome;
}

async function settleConflicts(selected: PendingConflict[], deps: PushDeps, outcome: PushOutcome) {
	if (selected.length === 0) return;
	const settled = (c: PendingConflict, choice: "mine" | "theirs") => {
		const pushed = pushedItem(deps.sync, c.kind, c.id);
		const task = c.kind === "task" ? deps.sync.pushedTasks[c.id] : undefined;
		const project = c.kind === "project" ? deps.sync.pushedProjects[c.id] : undefined;
		if (c.field === "status" && choice === "theirs") {
			recordAnswer(deps.sync, { kind: c.kind, id: c.id, answer: conflictAnswer(c), doneOn: c.doneOn ?? null });
		} else if (c.field === "status" && task) {
			const { done_on: _old, ...rest } = task.fields;
			task.fields = { ...rest, status: c.localStatus as PushedTaskStatus, priority: c.localValue };
		} else if (c.field === "status" && project) {
			project.fields = { ...project.fields, status: c.localStatus as ProjectStatus };
		} else {
			const value = choice === "mine" ? c.localValue : c.remoteValue;
			// Only a Task's priority may be null (inherit); a Project's conflict values are numbers.
			if (pushed && (value !== null || c.kind === "task")) (pushed.fields as { priority: number | null }).priority = value;
		}
		if (deps.sync.conflicts) delete deps.sync.conflicts[c.key.replace(/^conflict:/, "")];
		outcome.applied++;
	};

	const mine = selected.filter((c) => c.choice === "mine");
	const results = await send(deps.remote, mine.map((c) => c.change));
	mine.forEach((c, i) => {
		const result = results[i]!;
		if (result.ok) settled(c, "mine");
		else outcome.failed.push({ title: c.title, error: result.error });
	});

	for (const c of selected.filter((c) => c.choice === "theirs")) {
		try {
			if (c.field === "status") {
				if (!deps.writeAnswer) throw new Error("no vault writer");
				const answer = conflictAnswer(c);
				await deps.writeAnswer({ kind: c.kind, id: c.id, path: c.path, answer, doneOn: c.doneOn ?? null });
			} else {
				if (!deps.writePriority) throw new Error("no vault writer");
				await deps.writePriority(c.kind, c.id, c.path, c.remoteValue);
			}
			settled(c, "theirs");
		} catch (e) {
			outcome.failed.push({ title: c.title, error: `Suivi's value could not be written (${(e as Error).message})` });
		}
	}
	await deps.save();
}

function withProject(t: PendingTaskChange, projectId: string): PendingTaskChange {
	const fields = { ...t.fields, project_id: projectId };
	if (t.group === "new") return { ...t, fields, change: { ...t.change, fields } };
	return { ...t, fields, change: { ...t.change, fields: { ...t.change.fields, project_id: projectId } } };
}

async function send(remote: Remote, changes: PushChange[]): Promise<PushResult[]> {
	if (changes.length === 0) return [];
	const results = await remote.push(changes);
	if (results.length !== changes.length) {
		throw new RemoteError("server", `Suivi answered ${results.length} results for ${changes.length} changes.`);
	}
	return results;
}

type ItemChange = PendingProjectChange | PendingTaskChange;

/**
 * Prepares each change with `prepare` (a throw reports it and leaves it out),
 * sends them with their base and returns the applied ones with their id. A
 * create the app answers with another id than the one sent is reported.
 */
async function sendItems<T extends ItemChange>(
	selected: T[],
	deps: PushDeps,
	outcome: PushOutcome,
	prepare: (c: T) => Promise<{ change: T; sent: PushChange }>,
): Promise<{ change: T; id: string }[]> {
	const ready: { change: T; sent: PushChange }[] = [];
	for (const c of selected) {
		try {
			ready.push(await prepare(c));
		} catch (e) {
			outcome.failed.push({ title: c.title, error: (e as Error).message });
		}
	}
	const results = await send(deps.remote, ready.map((r) => ({ ...r.sent, base: { path: r.change.path, fields: r.change.fields } })));
	const applied: { change: T; id: string }[] = [];
	ready.forEach(({ change, sent }, i) => {
		const result = results[i]!;
		if (!result.ok) outcome.failed.push({ title: change.title, error: result.error });
		else if (sent.op === "create" && result.id !== sent.id) {
			outcome.failed.push({ title: change.title, error: `Suivi created it as ${result.id}, not ${sent.id}; fix the id in the note` });
		} else applied.push({ change, id: result.id });
	});
	outcome.applied += applied.length;
	return applied;
}

/**
 * A new Item's create with its id: the one the note carries, else a new one
 * written into the note by `write` first (a failed write throws: nothing is created).
 */
async function withId<T extends ItemChange>(c: T, write: (id: string) => Promise<void>, what: string): Promise<T> {
	if (c.group !== "new" || c.id) return c;
	const id = newAppId();
	try {
		await write(id);
	} catch (e) {
		throw new Error(`${what} ${id} could not be written (${(e as Error).message}); not created`);
	}
	return { ...c, id, change: { ...c.change, id } };
}

/** Pushes Project changes; returns the ids of the created ones by path. */
async function pushProjects(selected: PendingProjectChange[], deps: PushDeps, outcome: PushOutcome) {
	const applied = await sendItems(selected, deps, outcome, async (c) => {
		const change = await withId(c, (id) => deps.writeSuiviId(c.path, id), "suivi_id:");
		return { change, sent: change.change };
	});
	return new Map(applied.filter(({ change }) => change.group === "new").map(({ change, id }) => [change.path, id]));
}

/**
 * Pushes Task changes: bodies (the Description) are shared just before
 * sending; the base keeps the vault's text. A Task sent as done without a
 * date is sent with today's, then written into its line.
 */
async function pushTasks(selected: PendingTaskChange[], deps: PushDeps, outcome: PushOutcome) {
	const today = localDay();
	const dated = new Set<PendingTaskChange>();
	const applied = await sendItems(selected, deps, outcome, async (t) => {
		const identified = t.group === "new" ? await withId(t, (id) => deps.writeBlockId(t.path, t.ref, id), "^") : t;
		const change = datedTask(identified, today);
		if (change !== identified) dated.add(change);
		return { change, sent: await withSharedBody(change, deps) };
	});
	for (const { change, id } of applied) {
		if (dated.has(change)) {
			try {
				await deps.writeDoneDate(change.path, id, today, change.fields.step);
			} catch (e) {
				outcome.failed.push({
					title: change.title,
					error: `sent as done on ${today} but the date could not be written (${(e as Error).message}); add it to the line by hand`,
				});
			}
		}
	}
}

/** `t` with today as `done_on` when it sends a Task as done without a date; else `t` itself. */
function datedTask(t: PendingTaskChange, today: string): PendingTaskChange {
	if (t.fields.status !== "termine" || t.fields.done_on) return t;
	// A change that sends neither the status nor the date leaves the app's date as is.
	if (t.group === "changed" && !("done_on" in t.change.fields) && !("status" in t.change.fields)) return t;
	const fields = { ...t.fields, done_on: today };
	if (t.group === "new") return { ...t, fields, change: { ...t.change, fields } };
	return { ...t, fields, change: { ...t.change, fields: { ...t.change.fields, done_on: today } } };
}

/** The change to send: its `description`, when not empty, shared through `deps.shareBody`. */
async function withSharedBody(t: PendingTaskChange, deps: PushDeps): Promise<PushChange> {
	if (!t.change.fields.description || !deps.shareBody) return t.change;
	const description = await deps.shareBody(t.path, t.change.fields.description);
	return { ...t.change, fields: { ...t.change.fields, description } } as PushChange;
}

/** Id of a Project whose base is from `path` (its suivi_id may not be in the file cache yet). */
function findPushedProject(sync: SyncState, path: string): string | undefined {
	return Object.entries(sync.pushedProjects).find(([, p]) => p.path === path)?.[0];
}

function basename(path: string): string {
	const file = path.slice(path.lastIndexOf("/") + 1);
	return file.endsWith(".md") ? file.slice(0, -3) : file;
}
