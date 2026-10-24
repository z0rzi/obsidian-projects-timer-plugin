import { localDay } from "../localDate";
import { processLineById, rewriteTaskTag, setStepDone, setTaskToken } from "../lineWriter";
import type { ApiEvent, ItemAnswer, ItemAnsweredPayload, ProjectFields, TaskFields } from "../remote/api";
import type { SyncState } from "./pluginData";
import type { PullContext, VaultFiles } from "./runPull";
import { locateItem, projectNote, taskLine } from "./locateItem";
import { addConflict, conflictKey } from "./pullPriority";
import type { LocalTask } from "./sharedTask";

/**
 * `item.answered`: the Client answered a Task or Project À valider. Validé
 * makes a Tag task `#done <date>`, ticks a Project step with the date,
 * archives a Project
 * (`archived: true`); À reprendre makes a Task `p0` and a Project
 * `status: en cours`. The app's own changes for the Answer follow as
 * `item.updated` events tagged `answer` and are echoes by then. If the vault
 * changed the item's status (or a Task's priority) since the Push, nothing
 * is written: it's a `status` Pull conflict, settled in the Push modal.
 */
export async function pullItemAnswered(event: ApiEvent, ctx: PullContext): Promise<void> {
	const { answer } = event.payload as Partial<ItemAnsweredPayload>;
	if ((answer !== "valide" && answer !== "a_reprendre") || !event.item) return;
	if (ctx.sync.pushedProjects[event.item]) await pullProjectAnswer(event.item, answer, ctx);
	else if (ctx.sync.pushedTasks[event.item]) await pullTaskAnswer(event.item, answer, localDay(new Date(event.at)), ctx);
}

async function pullTaskAnswer(id: string, answer: ItemAnswer, date: string, ctx: PullContext) {
	const task = ctx.sync.pushedTasks[id]!;
	const { path, found: line } = await locateItem(ctx.files, id, task.path, taskLine(id));
	task.path = path;
	if (line.status !== task.fields.status || line.priority !== task.fields.priority) {
		const conflict = { kind: "task" as const, id, field: "status" as const, path, title: task.fields.title, remote: null, answer, doneOn: date };
		addConflict(ctx.sync, conflictKey(id, "status"), conflict);
		ctx.outcome.conflicts++;
		return;
	}
	await writeTaskAnswer(ctx.files, path, id, line, answer, date);
	task.fields = answeredTask(task.fields, answer, date);
	ctx.outcome.applied++;
}

async function pullProjectAnswer(id: string, answer: ItemAnswer, ctx: PullContext) {
	const project = ctx.sync.pushedProjects[id]!;
	const { path, found } = await locateItem(ctx.files, id, project.path, projectNote(id));
	project.path = path;
	if (found.fields.status !== project.fields.status) {
		const conflict = { kind: "project" as const, id, field: "status" as const, path, title: project.fields.title, remote: null, answer };
		addConflict(ctx.sync, conflictKey(id, "status"), conflict);
		ctx.outcome.conflicts++;
		return;
	}
	await writeProjectAnswer(ctx.files, path, answer);
	project.fields = answeredProject(project.fields, answer);
	ctx.outcome.applied++;
}

/** A Task's shared fields once the Answer is applied (`doneOn`: the date a Validé Task gets). */
export function answeredTask(fields: TaskFields, answer: ItemAnswer, doneOn: string | null): TaskFields {
	const { done_on: _old, ...rest } = fields;
	return answer === "valide"
		? { ...rest, status: "termine", priority: null, done_on: doneOn }
		: { ...rest, status: "en_cours", priority: 0 };
}

/** A Project's shared fields once the Answer is applied. */
export function answeredProject(fields: ProjectFields, answer: ItemAnswer): ProjectFields {
	return { ...fields, status: answer === "valide" ? "termine" : "en_cours" };
}

/** Records the Answer as last-pushed (the vault now holds it). */
export function recordAnswer(sync: SyncState, write: Omit<AnswerWrite, "path">): void {
	const project = write.kind === "project" ? sync.pushedProjects[write.id] : undefined;
	const task = write.kind === "task" ? sync.pushedTasks[write.id] : undefined;
	if (project) project.fields = answeredProject(project.fields, write.answer);
	if (task) task.fields = answeredTask(task.fields, write.answer, write.doneOn ?? null);
}

/** Whether a vault item's status (and a Task's priority) is what the Answer gives. */
export function holdsAnswer(kind: "project" | "task", answer: ItemAnswer, now: { status?: string; priority: number | null }) {
	if (answer === "valide") return now.status === "termine";
	return now.status === "en_cours" && (kind === "project" || now.priority === 0);
}

/** An Answer to write into the vault ("take Suivi's" on a `status` conflict from an Answer). */
export interface AnswerWrite {
	kind: "project" | "task";
	id: string;
	/** Where the item was last seen. */
	path: string;
	answer: ItemAnswer;
	/** Validé: the Task's done date (today if unset). */
	doneOn?: string | null;
}

/** Writes an Answer into the vault, finding a Task line that moved since. */
export async function writeAnswer(files: VaultFiles, write: AnswerWrite): Promise<void> {
	if (write.kind === "project") {
		await writeProjectAnswer(files, write.path, write.answer);
		return;
	}
	const { path, found } = await locateItem(files, write.id, write.path, taskLine(write.id));
	await writeTaskAnswer(files, path, write.id, found, write.answer, write.doneOn ?? localDay());
}

/** Validé: `archived: true` (pushed as Terminé). À reprendre: `status: en cours`. */
function writeProjectAnswer(files: VaultFiles, path: string, answer: ItemAnswer): Promise<void> {
	return files.processFrontMatter(path, (fm) => {
		if (answer === "valide") fm.archived = true;
		else fm.status = "en cours";
	});
}

async function writeTaskAnswer(files: VaultFiles, path: string, id: string, line: LocalTask, answer: ItemAnswer, date: string) {
	if (answer === "a_reprendre") await writeP0(files, path, id);
	else await writeDone(files, path, id, line, date);
}

/** Validé on the Task line `^id`: `#done <date>` for a Tag task, ticked with the date (token removed) for a Project step. */
async function writeDone(files: VaultFiles, path: string, id: string, line: LocalTask, date: string) {
	await processLineById(files.process, path, id, (now, ref) =>
		line.step ? setStepDone(now, ref, date) : rewriteTaskTag(now, ref, `#done ${date}`),
	);
}

/** Sets the `p0` token of the Task line `^id` (À reprendre). */
async function writeP0(files: VaultFiles, path: string, id: string): Promise<void> {
	await processLineById(files.process, path, id, (now, ref) => setTaskToken(now, ref, "p0"));
}
