import { describe, expect, it } from "vitest";
import type { ApiEvent, TaskFields } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { PULL_HANDLERS, runPull, type VaultFiles } from "../src/sync/runPull";
import { planTaskPush } from "../src/sync/taskPlan";
import { settleConflicts, withConflicts } from "../src/sync/conflicts";
import { runPush } from "../src/sync/runPush";
import { writeRemotePriority } from "../src/sync/pullPriority";
import { writeValidated } from "../src/sync/pullReview";
import type { PushChange, PushResult } from "../src/remote/api";
import { readProjectSteps, readTagTasks } from "../src/sync/sharedTask";

const meeting = "1.meetings/m.md";
const project = "2.projects/Widget.md";
const review: TaskFields = { title: "Widget", type: "task", step: false, status: "a_valider", priority: null, project_id: "p0002", description: "" };
const step: TaskFields = { title: "Export", type: "bug", step: true, status: "a_valider", priority: null, project_id: "p0002", description: "" };

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
		[project, "---\nsuivi_id: p0002\n---\n# Tasks\n- [ ] #bug pr Export ^s9xyz\n"],
	]);
	const vault: VaultFiles = {
		async read(path) {
			return files.get(path) ?? null;
		},
		async process(path, edit) {
			files.set(path, edit(files.get(path)!));
		},
		paths: () => [...files.keys()],
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
	/** The Push modal's list, conflicts included, and a Push of all of it. */
	const plan = () => {
		const tasks = [...readTagTasks(meeting, files.get(meeting)!, project), ...readProjectSteps(project, files.get(project)!)];
		settleConflicts(sync, [], tasks);
		return withConflicts(pending(), sync, [], tasks);
	};
	const received: PushChange[] = [];
	const push = (selected: ReturnType<typeof plan>) =>
		runPush(selected, {
			remote: {
				async push(changes) {
					received.push(...changes);
					return changes.map((c): PushResult => ({ ok: true, id: c.op === "create" ? "new" : c.id }));
				},
			} as Remote,
			sync,
			save: async () => {},
			writeSuiviId: async () => {},
			writeBlockId: async () => {},
			writePriority: (kind, id, path, p) => writeRemotePriority(vault, kind, id, path, p),
			writeValidated: (id, path, doneOn) => writeValidated(vault, id, path, doneOn),
		});
	return { files, sync, pull, pending, plan, push, received };
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

	it("Validé on a line edited since the Push: a conflict, the edit is kept", async () => {
		const w = world([answered("valide", "t7f3a")]);
		w.files.set(meeting, "#task p3 Widget ^t7f3a\nnotes");
		expect(await w.pull()).toEqual({ applied: 0, conflicts: 1, failed: [] });
		expect(w.files.get(meeting)).toBe("#task p3 Widget ^t7f3a\nnotes");
		expect(w.sync.pushedReviews!.r1abc!.answer).toBe("valide");
		expect(w.sync.conflicts).toEqual({
			"t7f3a:status": { kind: "task", id: "t7f3a", field: "status", path: meeting, title: "Widget", remote: null, doneOn: "2026-10-21" },
		});

		// Push modal: one conflict entry, no plain change sending the edited status.
		const pending = w.plan();
		expect(pending).toEqual([expect.objectContaining({ group: "conflict", local: "P3", remote: "Terminé" })]);
		const c = pending[0]!;
		if (c.group !== "conflict") throw new Error();
		c.choice = "theirs";
		expect(await w.push(pending)).toEqual({ applied: 1, failed: [] });
		expect(w.files.get(meeting)).toBe("#done 2026-10-21 Widget ^t7f3a\nnotes");
		expect(w.sync.conflicts).toEqual({});
		expect(w.plan()).toEqual([]);
	});

	it("Validé conflict, keep mine: the vault status and priority go to Suivi", async () => {
		const w = world([answered("valide", "t7f3a")]);
		w.files.set(meeting, "#task p3 Widget ^t7f3a\nnotes");
		await w.pull();
		expect(await w.push(w.plan())).toEqual({ applied: 1, failed: [] });
		expect(w.received).toEqual([{ op: "update", kind: "task", id: "t7f3a", fields: { status: "a_faire", priority: 3 } }]);
		expect(w.files.get(meeting)).toBe("#task p3 Widget ^t7f3a\nnotes");
		expect(w.plan()).toEqual([]);
	});

	it("À reprendre on a line edited since the Push: a priority conflict, the edit is kept", async () => {
		const w = world([answered("a_reprendre", "t7f3a")]);
		w.files.set(meeting, "#task p2 Widget ^t7f3a\nnotes");
		expect(await w.pull()).toEqual({ applied: 0, conflicts: 1, failed: [] });
		expect(w.files.get(meeting)).toBe("#task p2 Widget ^t7f3a\nnotes");
		expect(w.sync.conflicts).toEqual({
			"t7f3a:priority": { kind: "task", id: "t7f3a", field: "priority", path: meeting, title: "Widget", remote: 0 },
		});
	});

	it("works on a typed Project step too, keeping its tag", async () => {
		const ok = world([answered("valide", "s9xyz")]);
		await ok.pull();
		expect(ok.files.get(project)).toContain("- [x] #bug Export ^s9xyz");
		expect(ok.pending()).toEqual([]);
		const again = world([answered("a_reprendre", "s9xyz")]);
		await again.pull();
		expect(again.files.get(project)).toContain("- [ ] #bug p0 Export ^s9xyz");
		expect(again.pending()).toEqual([]);
	});

	it("does nothing for a Review without Task or a Task from elsewhere, and reports a missing line", async () => {
		const w = world([answered("valide", null), answered("valide", "zzzzz", "r9xxx")]);
		expect(await w.pull()).toEqual({ applied: 0, conflicts: 0, failed: [] });
		const gone = world([answered("valide", "t7f3a")]);
		gone.files.set(meeting, "plus rien");
		expect((await gone.pull()).failed).toHaveLength(1);
		// Kept: once the line is back, the next Pull applies the answer.
		gone.files.set(meeting, "#task pr Widget ^t7f3a\nnotes");
		expect(await gone.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(gone.files.get(meeting)).toBe("#done 2026-10-21 Widget ^t7f3a\nnotes");
	});

	it("finds the Task line in another note when it moved since the Push", async () => {
		const w = world([answered("valide", "t7f3a")]);
		w.files.set(meeting, "plus rien");
		w.files.set("1.meetings/n.md", "#task pr Widget ^t7f3a");
		expect(await w.pull()).toEqual({ applied: 1, conflicts: 0, failed: [] });
		expect(w.files.get("1.meetings/n.md")).toBe("#done 2026-10-21 Widget ^t7f3a");
		expect(w.sync.pushedTasks.t7f3a!.path).toBe("1.meetings/n.md");
	});
});
