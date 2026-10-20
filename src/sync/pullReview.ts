import { localDay } from "../localDate";
import { rewriteStepToken, rewriteTaskTag, setTaskToken, toggleCheckbox, type WriteResult } from "../lineWriter";
import type { ApiEvent, ReviewAnsweredPayload } from "../remote/api";
import type { PullContext } from "./runPull";
import { locateItem, taskLine } from "./locateItem";

/**
 * `review.answered`: the Client answered a Review. Validé makes its Task line
 * `#done <date>` (a Project step is ticked), À reprendre makes it `p0`. The
 * app's own Task changes for the answer follow as `item.updated` events and
 * are echoes by then. Answers are the Client's call: the line is written even
 * if it changed in the vault since the Push.
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
	const isStep = line.type === "step";
	const date = localDay(new Date(event.at));
	const ref = { line: -1, raw: "", blockId: taskId };

	let refused: string | null = null;
	await ctx.files.process(path, (now) => {
		let result: WriteResult;
		if (answer === "a_reprendre") result = setTaskToken(now, ref, "p0");
		else if (isStep) {
			result = rewriteStepToken(now, ref, null);
			if (result.ok && line.status !== "termine") result = toggleCheckbox(result.content, ref);
		} else result = rewriteTaskTag(now, ref, `#done ${date}`);
		if (result.ok) return result.content;
		refused = `^${taskId} is ${result.reason}`;
		return now;
	});
	if (refused) throw new Error(refused);

	const { done_on: _old, ...fields } = task.fields;
	task.fields =
		answer === "valide"
			? { ...fields, status: "termine", priority: null, done_on: isStep ? null : date }
			: { ...fields, status: "en_cours", priority: 0 };
	ctx.outcome.applied++;
}
