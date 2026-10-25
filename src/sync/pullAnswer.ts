import { markDone, processLineById, setTaskToken } from "../lineWriter";
import type { ItemAnswer, Priority, ProjectFields, TaskFields } from "../remote/api";
import type { VaultFiles } from "./runPull";
import { locateItem, taskLine } from "./locateItem";
import type { LocalTask } from "./sharedTask";

/** A Task's shared fields once the Answer is applied (`doneOn`: the date a Validé Task gets). */
export function answeredTask(fields: TaskFields, answer: ItemAnswer, doneOn: string | null): TaskFields {
	const { done_on: _old, ...rest } = fields;
	return answer === "valide" ? { ...rest, priority: null, done: true, done_on: doneOn } : { ...rest, priority: 0, done: false };
}

/** A Project's shared fields once the Answer is applied. */
export function answeredProject(fields: ProjectFields, answer: ItemAnswer): ProjectFields {
	return answer === "valide" ? { ...fields, priority: null, done: true } : { ...fields, priority: 0, done: false };
}

/** Whether a vault item is what the Answer gives: Done for Validé, open at P0 for À reprendre. */
export function holdsAnswer(answer: ItemAnswer, now: { priority: Priority | null; done: boolean }) {
	if (answer === "valide") return now.done;
	return !now.done && now.priority === 0;
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

/** Validé: `archived: true` (Done). À reprendre: `priority: 0`. */
function writeProjectAnswer(files: VaultFiles, path: string, answer: ItemAnswer): Promise<void> {
	return files.processFrontMatter(path, (fm) => {
		if (answer === "valide") fm.archived = true;
		else fm.priority = 0;
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
