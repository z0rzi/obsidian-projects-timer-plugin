// End-to-end check of Push and comments against a running Client app (edf-suivi), e.g. on
// localhost. Skipped unless SUIVI_E2E_URL and SUIVI_E2E_TOKEN (a Developer
// API token) are set:
//   SUIVI_E2E_URL=http://127.0.0.1:3999 SUIVI_E2E_TOKEN=... npx vitest run test/suivi.e2e.test.ts
// The Pull case also needs SUIVI_E2E_CLIENT_SESSION, a Client's `suivi_session`
// cookie value, to pick priorities on the site as JMJ would.
import { describe, expect, it } from "vitest";
import { createHttpRemote, type Transport } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";
import { planProjectPush } from "../src/sync/pushPlan";
import { runPush } from "../src/sync/runPush";
import { readSharedProject, type SharedProject } from "../src/sync/sharedProject";
import { readProjectSteps, readTagTasks } from "../src/sync/sharedTask";
import { planTaskPush, type ProjectLinks } from "../src/sync/taskPlan";
import { appendBlockId } from "../src/lineWriter";
import { commentTargetAt } from "../src/comments/commentTarget";
import { ThreadSession, type ThreadState } from "../src/comments/threadSession";
import { settleConflicts, withConflicts } from "../src/sync/conflicts";
import { writeRemotePriority } from "../src/sync/pullPriority";
import { PULL_HANDLERS, runPull, type VaultFiles } from "../src/sync/runPull";
import { withInboxNotice } from "../src/inbox/inboxNotice";
import { InboxStore } from "../src/inbox/inboxStore";
import { placeLine, runTriage } from "../src/inbox/triage";
import { runNewProject } from "../src/inbox/newProject";
import { setTaskToken } from "../src/lineWriter";
import { shareReviewBody } from "../src/sync/reviewBody";
import { planReviewPush } from "../src/sync/reviewPlan";
import { readReview } from "../src/sync/sharedReview";

const url = process.env.SUIVI_E2E_URL ?? "";
const token = process.env.SUIVI_E2E_TOKEN ?? "";
const clientSession = process.env.SUIVI_E2E_CLIENT_SESSION ?? "";

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

	it("follows the thread of the pushed Task under the cursor: reply, edit, delete", async () => {
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const [pushed] = await remote.push([
			{ op: "create", kind: "task", fields: { title: `Fil ${stamp}`, type: "task", status: "a_faire", priority: 2, project_id: null } },
		]);
		if (!pushed?.ok) throw new Error(JSON.stringify(pushed));
		const note = `#task p2 Fil ${stamp} ^${pushed.id}\n`;
		const target = commentTargetAt("notes.md", note, 0)!;
		expect(target).toEqual({ kind: "task", id: pushed.id, title: `Fil ${stamp}` });

		const states: ThreadState[] = [];
		const session = new ThreadSession(remote, (s) => states.push(s));
		await session.show(target);
		expect(session.current).toMatchObject({ status: "ready", comments: [] });

		expect(await session.reply("Réponse **depuis Obsidian**")).toBe(true);
		const [mine] = session.current.comments;
		expect(mine).toMatchObject({ body: "Réponse **depuis Obsidian**", mine: true, author_role: "developer" });

		expect(await session.edit(mine!.id, "Réponse corrigée")).toBe(true);
		expect(session.current.comments[0]).toMatchObject({ body: "Réponse corrigée", edited_at: expect.any(String) });
		expect(await session.remove(mine!.id)).toBe(true);
		expect(session.current.comments).toEqual([]);
		await expect(remote.comments("zzzzz")).rejects.toMatchObject({ kind: "server" });
	});
});

describe.skipIf(!url || !token || !clientSession)("Pull against a running Suivi", () => {
	it("brings JMJ's priority changes into the vault, refuses P0, and turns a clash into a conflict", async () => {
		const projectPath = `2.projects/Pull ${stamp}.md`;
		const meeting = `1.meetings/Pull ${stamp}.md`;
		const files = new Map<string, string>([
			[projectPath, "---\npriority: 3\n---\n# Tasks\n- [ ] Étape héritée\n"],
			[meeting, "#task p3 Tâche pull\n#bug p0 En cours pull\n"],
		]);
		const memory: VaultFiles = {
			read: async (p) => files.get(p) ?? null,
			process: async (p, edit) => void files.set(p, edit(files.get(p)!)),
		};
		const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
		const plan = () => {
			const projects = [...files].flatMap(([path, content]) => {
				const r = path.startsWith("2.projects/") ? readSharedProject(path, content) : null;
				return r?.ok ? [r.project] : [];
			});
			const tasks = [...files].flatMap(([path, content]) =>
				path.startsWith("2.projects/") ? readProjectSteps(path, content) : readTagTasks(path, content, null),
			);
			settleConflicts(sync, projects, tasks);
			const links: ProjectLinks = Object.fromEntries(
				projects.map((p) => [p.path, { title: p.fields.title, ...(p.suiviId ? { id: p.suiviId } : {}) }]),
			);
			const t = planTaskPush(tasks, links, sync.pushedTasks, { now: new Date(), doneHistory: sync.doneHistory });
			return withConflicts([...planProjectPush(projects, sync.pushedProjects), ...t.changes], sync, projects, tasks);
		};
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const deps = {
			remote,
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
			writePriority: (kind: "project" | "task", id: string, path: string, p: number | null) =>
				writeRemotePriority(memory, kind, id, path, p),
		};
		const pull = () => runPull({ remote, sync, save: async () => {}, files: memory });
		const pick = async (path: string, priority: number) =>
			(
				await fetch(`${url}${path}/priorite`, {
					method: "POST",
					headers: { cookie: `suivi_session=${clientSession}`, "content-type": "application/x-www-form-urlencoded" },
					body: `priority=${priority}`,
					redirect: "manual",
				})
			).status;

		expect(await runPush(plan(), deps)).toMatchObject({ failed: [] });
		await pull(); // catch up with everything so far (echoes of the Push)
		const idOf = (title: string) => Object.entries(sync.pushedTasks).find(([, t]) => t.fields.title === title)![0];
		const task = idOf("Tâche pull");
		const step = idOf("Étape héritée");
		const busy = idOf("En cours pull");

		expect(await pick(`/taches/${task}`, 1)).toBe(303);
		expect(await pick(`/taches/${step}`, 2)).toBe(303);
		expect(await pick(`/taches/${busy}`, 2)).toBe(403);
		expect(await pick(`/taches/${task}`, 0)).toBe(403);
		expect(await pull()).toEqual({ applied: 2, conflicts: 0, failed: [] });
		expect(files.get(meeting)).toMatch(/^#task p1 Tâche pull \^\w+\n#bug p0 En cours pull/);
		expect(files.get(projectPath)).toContain("- [ ] p2 Étape héritée ^");
		expect(await pull()).toEqual({ applied: 0, conflicts: 0, failed: [] });
		expect(plan()).toEqual([]);

		// The Developer moves it P1 → P4 without pushing; JMJ picks P5 meanwhile.
		files.set(meeting, files.get(meeting)!.replace("#task p1", "#task p4"));
		expect(await pick(`/taches/${task}`, 5)).toBe(303);
		expect(await pull()).toEqual({ applied: 0, conflicts: 1, failed: [] });
		expect(files.get(meeting)).toContain("#task p4 Tâche pull");
		const pending = plan();
		expect(pending).toMatchObject([{ group: "conflict", local: "P4", remote: "P5" }]);
		expect(await runPush(pending, deps)).toEqual({ applied: 1, failed: [] });
		expect(await pull()).toEqual({ applied: 0, conflicts: 0, failed: [] });
		expect(plan()).toEqual([]);
	});
});

describe.skipIf(!url || !token || !clientSession)("Inbox against a running Suivi", () => {
	it("lists JMJ's comment and priority change, not mine, and keeps read marks in the app", async () => {
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const [pushed] = await remote.push([
			{ op: "create", kind: "task", fields: { title: `Inbox ${stamp}`, type: "task", status: "a_faire", priority: 3, project_id: null } },
		]);
		if (!pushed?.ok) throw new Error(JSON.stringify(pushed));
		const id = pushed.id;
		const asClient = (path: string, body: string) =>
			fetch(`${url}${path}`, {
				method: "POST",
				headers: { cookie: `suivi_session=${clientSession}`, "content-type": "application/x-www-form-urlencoded" },
				body,
				redirect: "manual",
			});
		const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
		const files: VaultFiles = { read: async () => null, process: async () => {} };
		await runPull({ remote, sync, save: async () => {}, files }); // catch up

		expect((await asClient(`/items/${id}/commentaires`, "body=Une%20question")).status).toBe(303);
		expect((await asClient(`/taches/${id}/priorite`, "priority=1")).status).toBe(303);
		await remote.comment(id, "Ma réponse");

		const noticed: string[] = [];
		const handlers = withInboxNotice(PULL_HANDLERS, (e) => noticed.push(e.type));
		await runPull({ remote, sync, save: async () => {}, files }, handlers);
		expect(noticed).toEqual(["comment.created", "item.updated", "comment.created"]);

		const store = new InboxStore(remote, () => ({}), () => {});
		const ours = (s: InboxStore) => s.current.sections.flatMap((x) => x.entries).filter((e) => e.item.id === id);
		await store.refresh();
		expect(ours(store).map((e) => [e.kind, e.detail])).toEqual([
			["comment", "Une question"],
			["priority", "P3 → P1"],
		]);
		expect(store.unreadComments().has(id)).toBe(true);

		await store.markRead(ours(store)[0]!);
		const restarted = new InboxStore(remote, () => ({}), () => {});
		await restarted.refresh();
		expect(ours(restarted).map((e) => e.kind)).toEqual(["priority"]);
		await restarted.markAllRead();
		await store.refresh();
		expect(store.current.sections.find((x) => x.id === "notifications")!.entries).toEqual([]);
	});
});

describe.skipIf(!url || !token || !clientSession)("Tickets and Triage against a running Suivi", () => {
	it("JMJ's Bug reaches À trier after a Pull; Insérer ici writes its line and the same item becomes a Task", async () => {
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
		const files: VaultFiles = { read: async () => null, process: async () => {} };
		await runPull({ remote, sync, save: async () => {}, files }); // catch up

		const title = `Ticket ${stamp}`;
		const res = await fetch(`${url}/tickets`, {
			method: "POST",
			headers: { cookie: `suivi_session=${clientSession}`, "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ title, type: "bug", description: "Rien ne s'affiche ![](/uploads/x.png)" }).toString(),
			redirect: "manual",
		});
		expect(res.status).toBe(303);
		const id = res.headers.get("location")!.replace("/taches/", "");
		await remote.comment(id, "Je regarde");

		const noticed: string[] = [];
		await runPull({ remote, sync, save: async () => {}, files }, withInboxNotice(PULL_HANDLERS, (e) => noticed.push(e.type)));
		expect(noticed).toContain("ticket.created");

		const store = new InboxStore(remote, () => ({}), () => {});
		await store.refresh();
		const toTriage = store.current.sections.find((s) => s.id === "to-triage")!;
		const entry = toTriage.entries.find((e) => e.item.id === id)!;
		expect(entry).toMatchObject({ kind: "ticket", ticketType: "bug", detail: "Rien ne s'affiche ![](/uploads/x.png)" });

		const note = ["# Réunion", "", "suite"];
		const result = await runTriage(entry.item, { type: "bug", priority: 2 }, {
			remote,
			sync,
			save: async () => {},
			target: () => ({ path: "1.meetings/r.md", projectId: null }),
			insert: (line) => {
				const at = placeLine(note, 1, line);
				note.splice(1, 1, ...at.text.split("\n"));
			},
		});
		expect(result).toEqual({ ok: true, line: `#bug p2 ${title} ^${id}` });
		expect(note).toEqual(["# Réunion", `#bug p2 ${title} ^${id}`, "", "suite"]);

		await store.refresh();
		expect(store.current.sections.find((s) => s.id === "to-triage")!.entries.some((e) => e.item.id === id)).toBe(false);
		expect((await remote.comments(id)).map((c) => c.body)).toEqual(["Je regarde"]);

		// The next Push sees the line as already pushed.
		const local = readTagTasks("1.meetings/r.md", note.join("\n"), null);
		expect(planTaskPush(local, {}, sync.pushedTasks, { now: new Date() }).changes).toEqual([]);
		// Triaging twice is refused.
		expect(await runTriage(entry.item, { type: "bug", priority: 2 }, { ...noopDeps(remote, sync) })).toMatchObject({ ok: false });
	});
});

describe.skipIf(!url || !token || !clientSession)("Ideas against a running Suivi", () => {
	it("JMJ's Idée waits in the app until launched; Nouveau projet creates the file and the same item becomes a Project", async () => {
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
		const files: VaultFiles = { read: async () => null, process: async () => {} };
		await runPull({ remote, sync, save: async () => {}, files }); // catch up
		const jmj = { cookie: `suivi_session=${clientSession}`, "content-type": "application/x-www-form-urlencoded" };

		const title = `Idee ${stamp}`;
		const res = await fetch(`${url}/tickets`, {
			method: "POST",
			headers: jmj,
			body: new URLSearchParams({ title, type: "idea", description: "Voir les flux" }).toString(),
			redirect: "manual",
		});
		expect(res.status).toBe(303);
		const id = res.headers.get("location")!.replace("/taches/", "");
		await remote.comment(id, "Bonne idée");

		const store = new InboxStore(remote, () => ({}), () => {});
		const inToTriage = async () => {
			await store.refresh();
			return store.current.sections.find((s) => s.id === "to-triage")!.entries.find((e) => e.item.id === id);
		};
		expect(await inToTriage()).toBeUndefined();

		const launch = await fetch(`${url}/idees/${id}/lancer`, { method: "POST", headers: jmj, redirect: "manual" });
		expect(launch.status).toBe(303);
		const noticed: string[] = [];
		await runPull({ remote, sync, save: async () => {}, files }, withInboxNotice(PULL_HANDLERS, (e) => noticed.push(e.type)));
		expect(noticed).toContain("idea.launched");
		const entry = (await inToTriage())!;
		expect(entry).toMatchObject({ kind: "ticket", ticketType: "idea", detail: "Voir les flux" });

		const vault = new Map<string, string>();
		const result = await runNewProject(entry.item, { priority: 4 }, {
			remote,
			sync,
			save: async () => {},
			folder: "2.projects",
			template: async () => "---\npriority: 5\n---\n\n# Time usage\n---\n```project\n```\n\n# Tasks\n---",
			exists: (p) => vault.has(p),
			create: async (p, c) => void vault.set(p, c),
		});
		const path = `2.projects/${title}.md`;
		expect(result).toEqual({ ok: true, path });
		expect(await inToTriage()).toBeUndefined();
		expect((await remote.comments(id)).map((c) => c.body)).toEqual(["Bonne idée"]);

		// The next Push sees the file as already pushed.
		const read = readSharedProject(path, vault.get(path)!);
		expect(read).toMatchObject({ ok: true, project: { suiviId: id } });
		expect(planProjectPush([(read as { project: SharedProject }).project], sync.pushedProjects)).toEqual([]);

		const ideas = await (await fetch(`${url}/idees`, { headers: jmj })).text();
		expect(ideas).toContain(`href="/projets/${id}"`);
		expect(ideas).toContain("Lancée");
	});
});
describe.skipIf(!url || !token || !clientSession)("Reviews against a running Suivi", () => {
	it("publishes a Review note (image, Loom, wikilinks), sets its Task pr; JMJ's Validé comes back as #done", async () => {
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
		const projectPath = `2.projects/Revue E2E ${stamp}.md`;
		const reviewPath = `2.projects/reviews/Démo ${stamp}.md`;
		const loom = "0123456789abcdef0123456789abcdef";
		const files = new Map<string, string>([
			[projectPath, "---\npriority: 2\n---\n# Description\nWidget\n\n# Tasks\n---\n"],
			["1.meetings/rv.md", `#task p2 Widget revue ${stamp}\n`],
		]);
		const vault: VaultFiles = {
			read: async (p) => files.get(p) ?? null,
			process: async (p, edit) => void files.set(p, edit(files.get(p)!)),
		};
		const deps = {
			remote,
			sync,
			save: async () => {},
			writeSuiviId: async (p: string, id: string) => void files.set(p, files.get(p)!.replace("---\n", `---\nsuivi_id: ${id}\n`)),
			writeBlockId: async (p: string, ref: { line: number; raw: string }, id: string) => {
				const r = appendBlockId(files.get(p)!, ref, id);
				if (r.ok) files.set(p, r.content);
			},
			shareBody: (p: string, body: string) =>
				shareReviewBody(body, async () => remote.upload(new Uint8Array(Buffer.from(PNG, "base64")).buffer, "capture.png")),
			writeTaskToken: async (p: string, id: string, token: string) => {
				const r = setTaskToken(files.get(p)!, { line: -1, raw: "", blockId: id }, token);
				if (!r.ok) throw new Error(r.reason);
				files.set(p, r.content);
			},
		};
		await runPull({ remote, sync, save: async () => {}, files: vault }); // catch up

		// Project and Task first.
		const project = readSharedProject(projectPath, files.get(projectPath)!);
		if (!project?.ok) throw new Error("project unreadable");
		await runPush(planProjectPush([project.project], sync.pushedProjects), deps);
		const projectId = files.get(projectPath)!.match(/suivi_id: (\w+)/)![1]!;
		const links: ProjectLinks = { [projectPath]: { id: projectId, title: `Revue E2E ${stamp}` } };
		const tasks = readTagTasks("1.meetings/rv.md", files.get("1.meetings/rv.md")!, projectPath);
		await runPush(planTaskPush(tasks, links, sync.pushedTasks, { now: new Date() }).changes, deps);
		const taskId = files.get("1.meetings/rv.md")!.match(/\^(\w+)$/m)![1]!;

		files.set(
			reviewPath,
			`---\nproject: "[[Revue E2E ${stamp}]]"\ntask: ^${taskId}\n---\nVoir [[Revue E2E ${stamp}|le projet]].\n![[capture.png]]\nhttps://www.loom.com/share/${loom}\n`,
		);
		const planned = planReviewPush([{ ...readReview(reviewPath, files.get(reviewPath)!), projectPath }], links, {});
		expect(planned.problems).toEqual([]);
		expect(await runPush(planned.changes, deps)).toEqual({ applied: 1, failed: [] });
		const reviewId = files.get(reviewPath)!.match(/suivi_id: (\w+)/)![1]!;
		expect(files.get("1.meetings/rv.md")).toBe(`#task pr Widget revue ${stamp} ^${taskId}\n`);

		const site = (path: string, init: RequestInit = {}) =>
			fetch(`${url}${path}`, { ...init, redirect: "manual", headers: { cookie: `suivi_session=${clientSession}`, ...init.headers } });
		const page = await (await site(`/revues/${reviewId}`)).text();
		expect(page).toContain(`src="https://www.loom.com/embed/${loom}"`);
		expect(page).toMatch(/<img src="\/uploads\/[\w-]+\.png"/);
		expect(page).toContain("Voir le projet.");
		expect(page).not.toContain("[[");

		const answer = await site(`/revues/${reviewId}/reponse`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ answer: "valide", body: "Parfait" }).toString(),
		});
		expect(answer.status).toBe(303);
		expect((await remote.comments(reviewId)).map((c) => c.body)).toEqual(["Parfait"]);

		const outcome = await runPull({ remote, sync, save: async () => {}, files: vault });
		expect(outcome.failed).toEqual([]);
		expect(files.get("1.meetings/rv.md")).toMatch(new RegExp(`^#done \\d{4}-\\d{2}-\\d{2} Widget revue ${stamp} \\^${taskId}\\n$`));
		const after = readTagTasks("1.meetings/rv.md", files.get("1.meetings/rv.md")!, projectPath);
		expect(planTaskPush(after, links, sync.pushedTasks, { now: new Date() }).changes).toEqual([]);

		const store = new InboxStore(remote, () => ({}), () => {});
		await store.refresh();
		const entries = store.current.sections.flatMap((s) => s.entries).filter((e) => e.item.id === reviewId);
		expect(entries.map((e) => e.kind)).toEqual(["answer", "comment"]);
		await store.markAllRead();
	});
});

/** 1×1 transparent PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function noopDeps(remote: ReturnType<typeof createHttpRemote>, sync: SyncState) {
	return {
		remote,
		sync,
		save: async () => {},
		target: () => ({ path: "x.md", projectId: null }),
		insert: () => {
			throw new Error("must not write");
		},
	};
}
