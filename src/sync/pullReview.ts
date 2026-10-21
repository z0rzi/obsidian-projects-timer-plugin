import { localDay } from "../localDate";
import type { ApiEvent, ReviewAnsweredPayload } from "../remote/api";
import type { PullContext } from "./runPull";
import { locateItem, taskLine } from "./locateItem";
import { addConflict, conflictKey } from "./pullPriority";
import { answeredTask, writeDone, writeP0 } from "./pullAnswer";

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

	if (answer === "a_reprendre") await writeP0(ctx.files, path, taskId);
	else await writeDone(ctx.files, path, taskId, line, date);

	task.fields = answeredTask(task.fields, answer, isStep ? null : date);
	ctx.outcome.applied++;
}
