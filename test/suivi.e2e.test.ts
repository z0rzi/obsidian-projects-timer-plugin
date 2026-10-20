// End-to-end check of Push against a running Client app (edf-suivi), e.g. on
// localhost. Skipped unless SUIVI_E2E_URL and SUIVI_E2E_TOKEN (a Developer
// API token) are set:
//   SUIVI_E2E_URL=http://127.0.0.1:3999 SUIVI_E2E_TOKEN=... npx vitest run test/suivi.e2e.test.ts
import { describe, expect, it } from "vitest";
import { createHttpRemote, type Transport } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { planProjectPush } from "../src/sync/pushPlan";
import { runPush } from "../src/sync/runPush";
import { readSharedProject, type SharedProject } from "../src/sync/sharedProject";
import { readProjectSteps, readTagTasks } from "../src/sync/sharedTask";
import { planTaskPush, type ProjectLinks } from "../src/sync/taskPlan";
import { appendBlockId } from "../src/lineWriter";

const url = process.env.SUIVI_E2E_URL ?? "";
const token = process.env.SUIVI_E2E_TOKEN ?? "";

const fetchTransport: Transport = async (req) => {
	const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
	const text = await res.text();
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { status: res.status, json };
};

const stamp = Date.now().toString(36);

describe.skipIf(!url || !token)("Push against a running Suivi", () => {
	it("creates, updates and archives a Project, and rejects a bad token", async () => {
		const files = new Map<string, string>([
			[`2.projects/E2E ${stamp}.md`, "---\npriority: 2\nstatus: En cours\n---\n# Description\n---\nVu par **JMJ**.\n\n# Time usage\n---\n```project\n2026-10-19;60;secret\n```\n"],
			[`2.projects/Privé ${stamp}.md`, "---\nprive: true\n---\n# Description\nNon.\n"],
		]);
		const read = (): SharedProject[] =>
			[...files].flatMap(([path, content]) => {
				const r = readSharedProject(path, content);
				return r?.ok ? [r.project] : [];
			});
		const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const deps = {
			remote,
			sync,
			save: async () => {},
			writeSuiviId: async (path: string, id: string) => {
				files.set(path, files.get(path)!.replace("---\n", `---\nsuivi_id: ${id}\n`));
			},
		};

		const first = planProjectPush(read(), sync.pushedProjects);
		expect(first.map((c) => c.title)).toEqual([`E2E ${stamp}`]);
		expect(await runPush(first, deps)).toEqual({ applied: 1, failed: [] });
		const path = `2.projects/E2E ${stamp}.md`;
		const id = files.get(path)!.match(/suivi_id: (\w+)/)?.[1];
		expect(id).toMatch(/^[0-9a-z]{5}$/);

		files.set(path, files.get(path)!.replace("priority: 2", "priority: 1"));
		const second = planProjectPush(read(), sync.pushedProjects);
		expect(second).toMatchObject([{ group: "changed", diffs: [{ field: "priority", from: 2, to: 1 }] }]);
		expect(await runPush(second, deps)).toEqual({ applied: 1, failed: [] });

		const rejected = await remote.push([{ op: "update", kind: "project", id: id!, fields: { created_by: "x" } as never }]);
		expect(rejected).toMatchObject([{ ok: false, error: expect.stringContaining("created_by") }]);

		files.delete(path);
		const third = planProjectPush(read(), sync.pushedProjects);
		expect(third).toMatchObject([{ group: "deleted", id }]);
		expect(await runPush(third, deps)).toEqual({ applied: 1, failed: [] });

		const bad = createHttpRemote({ url, token: "not-a-token" }, fetchTransport);
		await expect(bad.push([])).rejects.toMatchObject({ kind: "auth" });
	});

	it("pushes Tag tasks and Project steps, writes their block IDs, moves and archives them", async () => {
		const projectPath = `2.projects/Tâches ${stamp}.md`;
		const meetingPath = `1.meetings/E2E ${stamp}.md`;
		const files = new Map<string, string>([
			[projectPath, "---\npriority: 3\n---\n# Description\nTest.\n# Tasks\n---\n- [ ] Étape héritée\n- [ ] p1 Étape urgente\n  corps privé\n- [ ] Secret #private\n"],
			[meetingPath, "#task p2 Tâche de réunion\n  notes privées\n\n#bug pr Bug à valider\n#task p1 Paie #private\n"],
		]);
		const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
		const plan = () => {
			const projects = [...files].flatMap(([path, content]) => {
				const r = path.startsWith("2.projects/") ? readSharedProject(path, content) : null;
				return r?.ok ? [r.project] : [];
			});
			const links: ProjectLinks = Object.fromEntries(
				projects.map((p) => [p.path, { title: p.fields.title, ...(p.suiviId ? { id: p.suiviId } : {}) }]),
			);
			const tasks = [...files].flatMap(([path, content]) => [
				...readTagTasks(path, content, path === meetingPath ? projectPath : path.startsWith("2.") ? path : null),
				...(path.startsWith("2.projects/") ? readProjectSteps(path, content) : []),
			]);
			const t = planTaskPush(tasks, links, sync.pushedTasks, { now: new Date(), doneHistory: sync.doneHistory });
			return [...planProjectPush(projects, sync.pushedProjects), ...t.changes];
		};
		const deps = {
			remote: createHttpRemote({ url, token }, fetchTransport),
			sync,
			save: async () => {},
			writeSuiviId: async (path: string, id: string) => {
				files.set(path, files.get(path)!.replace("---\n", `---\nsuivi_id: ${id}\n`));
			},
			writeBlockId: async (path: string, ref: { line: number; raw: string }, id: string) => {
				const r = appendBlockId(files.get(path)!, ref, id);
				if (!r.ok) throw new Error(r.reason);
				files.set(path, r.content);
			},
		};

		const first = plan();
		expect(first.map((c) => c.title).sort()).toEqual(
			[`Tâches ${stamp}`, "Bug à valider", "Tâche de réunion", "Étape héritée", "Étape urgente"].sort(),
		);
		expect(await runPush(first, deps)).toEqual({ applied: 5, failed: [] });
		expect(files.get(meetingPath)).toMatch(/^#task p2 Tâche de réunion \^[0-9a-z]{5}\n  notes privées\n/);
		expect(files.get(projectPath)).toMatch(/- \[ \] Étape héritée \^[0-9a-z]{5}\n/);
		expect(plan()).toEqual([]);

		// Move the meeting Task into a standalone note, check a step, delete the bug.
		const taskLine = files.get(meetingPath)!.split("\n")[0]!;
		files.set(meetingPath, files.get(meetingPath)!.replace(`${taskLine}\n`, "").replace(/#bug pr .*\n/, ""));
		files.set(`0.inbox/Notes ${stamp}.md`, `${taskLine}\n`);
		files.set(projectPath, files.get(projectPath)!.replace("- [ ] Étape héritée", "- [x] Étape héritée"));
		const second = plan();
		expect(second.map((c) => c.group).sort()).toEqual(["changed", "changed", "deleted"]);
		expect(second).toContainEqual(
			expect.objectContaining({
				group: "changed",
				title: "Tâche de réunion",
				diffs: [expect.objectContaining({ field: "project", to: "none" })],
			}),
		);
		expect(await runPush(second, deps)).toEqual({ applied: 3, failed: [] });
		expect(plan()).toEqual([]);
	});
});
