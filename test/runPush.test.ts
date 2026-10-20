import { describe, expect, it } from "vitest";
import type { ProjectFields, PushChange, PushResult } from "../src/remote/api";
import { RemoteError, type Remote } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { planProjectPush } from "../src/sync/pushPlan";
import { runPush } from "../src/sync/runPush";
import type { SharedProject } from "../src/sync/sharedProject";

const base: ProjectFields = { title: "Widget", description: "", status: "a_faire", priority: 2 };

/** An app that numbers new items and rejects changes whose title is "Refusé". */
function fakeApp() {
	const received: PushChange[][] = [];
	let next = 0;
	const remote: Remote = {
		async push(changes) {
			received.push(changes);
			return changes.map((c): PushResult => {
				if (c.op !== "archive" && c.fields.title === "Refusé") return { ok: false, error: "Titre refusé" };
				return { ok: true, id: c.op === "create" ? `id${next++}` : c.id };
			});
		},
	};
	return { remote, received };
}

/** A vault of Project files whose `suivi_id:` the push writes back. */
function fakeVault(projects: Record<string, Partial<ProjectFields>>) {
	const ids: Record<string, string> = {};
	const files = new Map(Object.entries(projects).map(([title, f]) => [title, { ...base, title, ...f }]));
	const sync: SyncState = { pushedProjects: {} };
	let saves = 0;
	return {
		files,
		sync,
		ids,
		saves: () => saves,
		local: (): SharedProject[] =>
			[...files.values()].map((fields) => ({
				path: `p/${fields.title}.md`,
				suiviId: ids[`p/${fields.title}.md`],
				archived: false,
				fields,
			})),
		deps: (remote: Remote) => ({
			remote,
			sync,
			save: async () => {
				saves++;
			},
			writeSuiviId: async (path: string, id: string) => {
				ids[path] = id;
			},
		}),
	};
}

const plan = (v: ReturnType<typeof fakeVault>) => planProjectPush(v.local(), v.sync.pushedProjects);

describe("runPush", () => {
	it("creates new Projects, writes their suivi_id and leaves nothing pending", async () => {
		const app = fakeApp();
		const v = fakeVault({ Widget: {}, Talon: { priority: 0 } });

		const outcome = await runPush(plan(v), v.deps(app.remote));

		expect(outcome).toEqual({ applied: 2, failed: [] });
		expect(v.ids).toEqual({ "p/Widget.md": "id0", "p/Talon.md": "id1" });
		expect(plan(v)).toEqual([]);
		expect(v.saves()).toBeGreaterThan(0);
	});

	it("keeps unticked changes pending and pushes them next time", async () => {
		const app = fakeApp();
		const v = fakeVault({ A: {}, B: {} });
		await runPush(plan(v), v.deps(app.remote));
		v.files.set("A", { ...v.files.get("A")!, priority: 1 });
		v.files.set("B", { ...v.files.get("B")!, status: "en_pause" });

		const pending = plan(v);
		await runPush(pending.filter((c) => c.title === "A"), v.deps(app.remote));

		expect(app.received.at(-1)).toEqual([{ op: "update", kind: "project", id: "id0", fields: { priority: 1 } }]);
		expect(plan(v)).toMatchObject([
			{ group: "changed", title: "B", diffs: [{ field: "status", from: "a_faire", to: "en_pause" }] },
		]);
	});

	it("reports a change the app rejected and keeps it pending, applying the others", async () => {
		const app = fakeApp();
		const v = fakeVault({ Refusé: {}, Accepté: {} });

		const outcome = await runPush(plan(v), v.deps(app.remote));

		expect(outcome).toEqual({ applied: 1, failed: [{ title: "Refusé", error: "Titre refusé" }] });
		expect(plan(v)).toMatchObject([{ group: "new", title: "Refusé" }]);
	});

	it("archives a deleted Project and forgets it", async () => {
		const app = fakeApp();
		const v = fakeVault({ Widget: {} });
		await runPush(plan(v), v.deps(app.remote));
		v.files.delete("Widget");

		const pending = plan(v);
		expect(pending).toMatchObject([{ group: "deleted", title: "Widget" }]);
		await runPush(pending, v.deps(app.remote));

		expect(app.received.at(-1)).toEqual([{ op: "archive", kind: "project", id: "id0" }]);
		expect(plan(v)).toEqual([]);
	});

	it("changes nothing when the app refuses the token", async () => {
		const v = fakeVault({ Widget: {} });
		const refusing: Remote = {
			push: async () => {
				throw new RemoteError("auth", "Suivi a refusé le jeton API.");
			},
		};

		await expect(runPush(plan(v), v.deps(refusing))).rejects.toMatchObject({ kind: "auth" });
		expect(v.ids).toEqual({});
		expect(plan(v)).toHaveLength(1);
	});

	it("does not call the app when nothing is ticked", async () => {
		const app = fakeApp();
		const v = fakeVault({ Widget: {} });

		expect(await runPush([], v.deps(app.remote))).toEqual({ applied: 0, failed: [] });
		expect(app.received).toEqual([]);
	});
});
