import { markDone, processLineById, setTaskToken } from "../lineWriter";
import type { ItemAnswer, ProjectFields, TaskFields } from "../remote/api";
import type { VaultFiles } from "./runPull";
import { locateItem, taskLine } from "./locateItem";
import type { LocalTask } from "./sharedTask";

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

/** Whether a vault item's status (and a Task's priority) is what the Answer gives. */
export function holdsAnswer(kind: "project" | "task", answer: ItemAnswer, now: { status?: string; priority: number | null }) {
	if (answer === "valide") return now.status === "termine";
	return now.status === "en_cours" && (kind === "project" || now.priority === 0);
}

/** The Client's Answer to write into the vault (a Pull, or the Client's side of a conflict). */
export interface AnswerWrite {
	kind: "project" | "task";
	id: string;
	/** Where the item was last seen. */
	path: string;
	answer: ItemAnswer;
	/** Validé: the Task's done date, the local day of the Answer. */
	doneOn: string;
}

/** Writes an Answer into the vault, finding a Task line that moved since. */
export async function writeAnswer(files: VaultFiles, write: AnswerWrite): Promise<void> {
	if (write.kind === "project") {
		await writeProjectAnswer(files, write.path, write.answer);
		return;
	}
	const { path, found } = await locateItem(files, write.id, write.path, taskLine(write.id));
	await writeTaskAnswer(files, path, write.id, found, write.answer, write.doneOn);
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
	await processLineById(files.process, path, id, (now, ref) => markDone(now, ref, line.step, date));
}

/** Sets the `p0` token of the Task line `^id` (À reprendre). */
async function writeP0(files: VaultFiles, path: string, id: string): Promise<void> {
	await processLineById(files.process, path, id, (now, ref) => setTaskToken(now, ref, "p0"));
}
