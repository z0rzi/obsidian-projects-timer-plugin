import { localDay } from "../localDate";
import { processLineById, rewriteStepToken, rewriteTaskTag, setTaskToken, toggleCheckbox } from "../lineWriter";
import type { ApiEvent, ReviewAnsweredPayload } from "../remote/api";
import type { PullContext, VaultFiles } from "./runPull";
import { locateItem, taskLine } from "./locateItem";
import { addConflict, conflictKey } from "./pullPriority";
import type { LocalTask } from "./sharedTask";

/**
 * `review.answered`: the Client answered a Review. Validé makes its Task line
 * `#done <date>` (a Project step is ticked), À reprendre makes it `p0`. The
 * app's own Task changes for the answer follow as `item.updated` events and
 * are echoes by then. If the line's status or priority changed in the vault
 * since the Push (not pushed yet), nothing is written: it's a Pull conflict
 * (status for Validé, priority for À reprendre), settled in the Push modal.
 */
export async function pullReviewAnswered(event: ApiEvent, ctx: PullContext): Promise<void> {
	const { answer, task_id: taskId } = event.payload as Partial<ReviewAnsweredPayload>;
	if (answer !== "valide" && answer !== "a_reprendre") return;
	const review = event.item ? ctx.sync.pushedReviews?.[event.item] : undefined;
	if (review) review.answer = answer;
	const task = taskId ? ctx.sync.pushedTasks[taskId] : undefined;
	if (!taskId || !task) return; // no Task, or not from this vault

	const { path, found: line } = await locateItem(ctx.files, taskId, task.path, taskLine(taskId));
	task.path = path;
	const date = localDay(new Date(event.at));
	const isStep = line.step;

	if (line.status !== task.fields.status || line.priority !== task.fields.priority) {
		const base = { kind: "task" as const, id: taskId, path, title: task.fields.title };
		if (answer === "valide") {
			const doneOn = isStep ? null : date;
			addConflict(ctx.sync, conflictKey(taskId, "status"), { ...base, field: "status", remote: null, doneOn });
		} else {
			addConflict(ctx.sync, conflictKey(taskId, "priority"), { ...base, field: "priority", remote: 0 });
		}
		ctx.outcome.conflicts++;
		return;
	}

	if (answer === "a_reprendre") {
		await processLineById(ctx.files.process, path, taskId, (now, ref) => setTaskToken(now, ref, "p0"));
	} else await writeDone(ctx.files, path, taskId, line, date);

	const { done_on: _old, ...fields } = task.fields;
	task.fields =
		answer === "valide"
			? { ...fields, status: "termine", priority: null, done_on: isStep ? null : date }
			: { ...fields, status: "en_cours", priority: 0 };
	ctx.outcome.applied++;
}

/**
 * Marks the Task line `^id` done as a Validé answer does: `#done <doneOn>`
 * for a Tag task, ticked (token removed) for a Project step. "Take Suivi's"
 * on a status conflict.
 */
export async function writeValidated(files: VaultFiles, id: string, path: string, doneOn: string | null): Promise<void> {
	const { path: at, found } = await locateItem(files, id, path, taskLine(id));
	await writeDone(files, at, id, found, doneOn ?? localDay());
}

async function writeDone(files: VaultFiles, path: string, id: string, line: LocalTask, date: string) {
	await processLineById(files.process, path, id, (now, ref) => {
		if (!line.step) return rewriteTaskTag(now, ref, `#done ${date}`);
		const result = rewriteStepToken(now, ref, null);
		return result.ok && line.status !== "termine" ? toggleCheckbox(result.content, ref) : result;
	});
}
