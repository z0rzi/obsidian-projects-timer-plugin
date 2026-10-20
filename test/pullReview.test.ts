import { describe, expect, it } from "vitest";
import type { ApiEvent, TaskFields } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { PULL_HANDLERS, runPull, type VaultFiles } from "../src/sync/runPull";
import { planTaskPush } from "../src/sync/taskPlan";
import { readProjectSteps, readTagTasks } from "../src/sync/sharedTask";

const meeting = "1.meetings/m.md";
const project = "2.projects/Widget.md";
const review: TaskFields = { title: "Widget", type: "task", status: "a_valider", priority: null, project_id: "p0002" };
const step: TaskFields = { title: "Export", type: "step", status: "a_valider", priority: null, project_id: "p0002" };

function world(events: Omit<ApiEvent, "id">[]) {
	const log: ApiEvent[] = events.map((e, i) => ({ ...e, id: i + 1 }));
	const remote = {
		async pull(cursor: number | null) {
			const fresh = log.filter((e) => e.id > (cursor ?? 0));
			return { events: fresh, cursor: fresh.at(-1)?.id ?? cursor ?? 0 };
		},
	} as unknown as Remote;
	const files = new Map([
		[meeting, "#task pr Widget ^t7f3a\nnotes"],
		[project, "---\nsuivi_id: p0002\n---\n# Tasks\n- [ ] pr Export ^s9xyz\n"],
	]);
	const vault: VaultFiles = {
		async read(path) {
			return files.get(path) ?? null;
		},
		async process(path, edit) {
			files.set(path, edit(files.get(path)!));
		},
	};
	const sync: SyncState = {
		pushedProjects: {},
		pushedTasks: { t7f3a: { path: meeting, fields: review }, s9xyz: { path: project, fields: step } },
		pushedReviews: { r1abc: { path: "2.projects/reviews/D.md", fields: { title: "D", body: "", project_id: "p0002", task_id: "t7f3a" }, answer: "en_attente" } },
	};
	const pull = () => runPull({ remote, sync, save: async () => {}, files: vault }, PULL_HANDLERS);
	const pending = () =>
		planTaskPush(
			[...readTagTasks(meeting, files.get(meeting)!, project), ...readProjectSteps(project, files.get(project)!)],
			{ [project]: { id: "p0002", title: "Widget" } },
			sync.pushedTasks,
			{ now: new Date("2026-10-21T10:00:00Z"), doneHistory: [] },
		).changes;
	return { files, sync, pull, pending };
}

const answered = (answer: string, task_id: string | null, item = "r1abc"): Omit<ApiEvent, "id"> => ({
	at: "2026-10-21T09:30:00.000Z",
	actor: "u-jmj",
	type: "review.answered",
	item,
	payload: { answer, task_id },
});
const taskUpdate = (item: string, field: string, from: unknown, to: unknown): Omit<ApiEvent, "id"> => ({
	at: "2026-10-21T09:30:00.000Z",
	actor: "u-jmj",
	type: "item.updated",
	item,
	payload: { field, from, to, review: "r1abc" },
});

describe("Pull: Review answers", () => {
	it("Validé: the Task line becomes #done <date>, with nothing left to push", async () => {
		const w = world([answered("valide", "t7f3a"), taskUpdate("t7f3a", "status", "a_valider", "termine")]);
		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get(meeting)).toBe("#done 2026-10-21 Widget ^t7f3a\nnotes");
		expect(w.sync.pushedReviews!.r1abc!.answer).toBe("valide");
		expect(w.pending()).toEqual([]);
	});

	it("Validé: dates #done with the local day of the answer", async () => {
		const late = { ...answered("valide", "t7f3a"), at: "2026-10-21T23:30:00.000Z" };
		const w = world([late]);
		await w.pull();
		expect(w.files.get(meeting)).toBe("#done 2026-10-22 Widget ^t7f3a\nnotes");
	});

	it("À reprendre: the Task line becomes p0, with nothing left to push", async () => {
		const w = world([
			answered("a_reprendre", "t7f3a"),
			taskUpdate("t7f3a", "status", "a_valider", "en_cours"),
			taskUpdate("t7f3a", "priority", 2, 0),
		]);
		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get(meeting)).toBe("#task p0 Widget ^t7f3a\nnotes");
		expect(w.pending()).toEqual([]);
	});

	it("works on a Project step too", async () => {
		const ok = world([answered("valide", "s9xyz")]);
		await ok.pull();
		expect(ok.files.get(project)).toContain("- [x] Export ^s9xyz");
		expect(ok.pending()).toEqual([]);
		const again = world([answered("a_reprendre", "s9xyz")]);
		await again.pull();
		expect(again.files.get(project)).toContain("- [ ] p0 Export ^s9xyz");
		expect(again.pending()).toEqual([]);
	});

	it("does nothing for a Review without Task or a Task from elsewhere, and reports a missing line", async () => {
		const w = world([answered("valide", null), answered("valide", "zzzzz", "r9xxx")]);
		expect(await w.pull()).toEqual({ applied: 0, conflicts: 0, failed: [] });
		const gone = world([answered("valide", "t7f3a")]);
		gone.files.set(meeting, "plus rien");
		expect((await gone.pull()).failed).toHaveLength(1);
	});
});
