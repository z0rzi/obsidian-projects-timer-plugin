import { describe, expect, it } from "vitest";
import type { PushChange, PushResult, TaskFields } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { planReviewPush } from "../src/sync/reviewPlan";
import { runPush } from "../src/sync/runPush";
import { readReview } from "../src/sync/sharedReview";
import type { ProjectLinks } from "../src/sync/taskPlan";

function fakeApp() {
	const received: PushChange[][] = [];
	let next = 0;
	const remote = {
		async push(changes: PushChange[]) {
			received.push(changes);
			return changes.map((c): PushResult => ({ ok: true, id: c.op === "create" ? `r${next++}` : c.id }));
		},
	} as unknown as Remote;
	return { remote, received };
}

const path = "2.projects/reviews/Démo.md";
const task: TaskFields = { title: "Widget", type: "task", status: "a_faire", priority: 2, project_id: "p0002" };

function world(content: string, links: ProjectLinks = { "2.projects/Widget.md": { id: "p0002", title: "Widget" } }) {
	const sync: SyncState = {
		pushedProjects: {},
		pushedTasks: { t7f3a: { path: "2.projects/Widget.md", fields: task } },
	};
	const files = new Map([[path, content]]);
	const tokens: [string, string, string][] = [];
	const shared: string[] = [];
	const plan = () =>
		planReviewPush([{ ...readReview(path, files.get(path)!), projectPath: "2.projects/Widget.md" }], links, sync.pushedReviews ?? {});
	const deps = (remote: Remote) => ({
		remote,
		sync,
		save: async () => {},
		writeSuiviId: async (p: string, id: string) => {
			files.set(p, files.get(p)!.replace("---\n", `---\nsuivi_id: ${id}\n`));
		},
		writeBlockId: async () => {},
		shareBody: async (p: string, body: string) => {
			shared.push(p);
			return body.replace("![[a.png]]", "![](/uploads/a.png)");
		},
		writeTaskToken: async (p: string, id: string, token: string) => {
			tokens.push([p, id, token]);
		},
	});
	return { sync, files, tokens, shared, plan, deps };
}

describe("runPush: Reviews", () => {
	it("publishes a Review with its images uploaded, writes suivi_id, and sets its Task to pr", async () => {
		const w = world("---\nproject: Widget\ntask: ^t7f3a\n---\nVoir ![[a.png]]\n");
		const app = fakeApp();
		const outcome = await runPush(w.plan().changes, w.deps(app.remote));
		expect(outcome).toEqual({ applied: 1, failed: [] });
		expect(app.received).toEqual([
			[
				{
					op: "create",
					kind: "review",
					fields: { title: "Démo", body: "Voir ![](/uploads/a.png)", project_id: "p0002", task_id: "t7f3a" },
				},
			],
		]);
		expect(w.files.get(path)).toContain("suivi_id: r0");
		expect(w.tokens).toEqual([["2.projects/Widget.md", "t7f3a", "pr"]]);
		expect(w.sync.pushedTasks.t7f3a!.fields).toMatchObject({ status: "a_valider", priority: null });
		// The vault body is the base for the next diff: nothing left to push.
		expect(w.sync.pushedReviews?.r0?.fields.body).toBe("Voir ![[a.png]]");
		expect(w.plan().changes).toEqual([]);
	});

	it("reports a Review whose images could not be uploaded, and pushes nothing for it", async () => {
		const w = world("---\nproject: Widget\n---\nTexte\n");
		const app = fakeApp();
		const deps = { ...w.deps(app.remote), shareBody: async () => Promise.reject(new Error("image b.png not found")) };
		const outcome = await runPush(w.plan().changes, deps);
		expect(outcome).toEqual({ applied: 0, failed: [{ title: "Démo", error: "image b.png not found" }] });
		expect(app.received).toEqual([]);
	});

	it("a reworked Review answered À reprendre puts its Task back to pr", async () => {
		const w = world("---\nproject: Widget\ntask: ^t7f3a\n---\nV1\n");
		const app = fakeApp();
		await runPush(w.plan().changes, w.deps(app.remote));
		w.sync.pushedReviews!.r0!.answer = "a_reprendre";
		w.sync.pushedTasks.t7f3a!.fields = { ...task, status: "en_cours", priority: 0 };
		w.files.set(path, w.files.get(path)!.replace("V1", "V2"));
		w.tokens.length = 0;
		await runPush(w.plan().changes, w.deps(app.remote));
		expect(w.tokens).toEqual([["2.projects/Widget.md", "t7f3a", "pr"]]);
		expect(w.sync.pushedReviews!.r0!.answer).toBe("en_attente");
	});

	it("waits for its Project created in the same Push", async () => {
		const w = world("---\nproject: Widget\n---\nTexte\n", { "2.projects/Widget.md": { title: "Widget" } });
		const app = fakeApp();
		const outcome = await runPush(w.plan().changes, w.deps(app.remote));
		expect(outcome.failed).toMatchObject([{ title: "Démo", error: expect.stringContaining("push it too") }]);
	});
});
