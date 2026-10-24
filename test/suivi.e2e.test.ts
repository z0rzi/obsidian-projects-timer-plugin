// End-to-end check of Push and comments against a running Client app (edf-suivi), e.g. on
// localhost. Skipped unless SUIVI_E2E_URL and SUIVI_E2E_TOKEN (a Developer
// API token) are set:
//   SUIVI_E2E_URL=http://127.0.0.1:3999 SUIVI_E2E_TOKEN=... npx vitest run test/suivi.e2e.test.ts
// The Pull case also needs SUIVI_E2E_CLIENT_SESSION, a Client's `suivi_session`
// cookie value, to pick priorities on the site as JMJ would.
import { describe, expect, it } from "vitest";
import { createHttpRemote, type Transport } from "../src/remote/remote";
import { planProjectPush } from "../src/sync/pushPlan";
import { runPush } from "../src/sync/runPush";
import { readSharedProject, type SharedProject } from "../src/sync/sharedProject";
import { readProjectSteps, readTagTasks } from "../src/sync/sharedTask";
import { planTaskPush, type ProjectLinks } from "../src/sync/taskPlan";
import { appItems } from "../src/sync/appState";
import { vaultWriters } from "../src/sync/runPush";
import { fetchAppItems } from "../src/sync/appState";
import { memoryVault } from "./fakeSuivi";
import { commentTargetAt } from "../src/comments/commentTarget";
import { ThreadSession, type ThreadState } from "../src/comments/threadSession";
import { pickConflict } from "../src/sync/conflicts";
import { planPush, readVaultItems } from "../src/sync/planPush";
import { runPull } from "../src/sync/runPull";
import { InboxStore } from "../src/inbox/inboxStore";
import { placeLine, runTriage } from "../src/inbox/triage";
import { runNewProject } from "../src/inbox/newProject";

const url = process.env.SUIVI_E2E_URL ?? "";
const token = process.env.SUIVI_E2E_TOKEN ?? "";
const clientSession = process.env.SUIVI_E2E_CLIENT_SESSION ?? "";

const fetchTransport: Transport = async (req) => {
	const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
	const contentType = res.headers.get("content-type") ?? "";
	if (contentType.startsWith("image/")) return { status: res.status, json: null, arrayBuffer: await res.arrayBuffer(), contentType };
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
	it("creates and updates a Project, and rejects a bad token", async () => {
		const files = new Map<string, string>([
			[`2.projects/E2E ${stamp}.md`, "---\npriority: 2\nstatus: En cours\n---\n# Description\n---\nVu par **JMJ**.\n\n# Time usage\n---\n```project\n2026-10-19;60;secret\n```\n"],
			[`2.projects/Privé ${stamp}.md`, "---\nprive: true\n---\n# Description\nNon.\n"],
		]);
		const read = (): SharedProject[] =>
			[...files].flatMap(([path, content]) => {
				const r = readSharedProject(path, content);
				return r?.ok ? [r.project] : [];
			});
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const deps = {
			remote,
			app: appItems([]),
			writeSuiviId: async (path: string, id: string) => {
				files.set(path, files.get(path)!.replace("---\n", `---\nsuivi_id: ${id}\n`));
			},
			writeBlockId: async () => {},
			writeDoneDate: async () => {},
		};
		const plan = async () => planProjectPush(read(), appItems(await remote.state()));

		const first = await plan();
		expect(first.map((c) => c.title)).toEqual([`E2E ${stamp}`]);
		expect(await runPush(first, deps)).toEqual({ applied: 1, failed: [] });
		const path = `2.projects/E2E ${stamp}.md`;
		const id = files.get(path)!.match(/suivi_id: (\w+)/)?.[1];
		expect(id).toMatch(/^[0-9a-z]{5}$/);

		files.set(path, files.get(path)!.replace("priority: 2", "priority: 1"));
		const second = await plan();
		expect(second).toMatchObject([{ group: "changed", diffs: [{ field: "priority", from: 2, to: 1 }] }]);
		expect(await runPush(second, deps)).toEqual({ applied: 1, failed: [] });

		const rejected = await remote.push([{ op: "update", kind: "project", id: id!, fields: { created_by: "x" } as never }]);
		expect(rejected).toMatchObject([{ ok: false, error: expect.stringContaining("created_by") }]);

		// A Project no note carries is Unplaced, never offered.
		files.delete(path);
		expect(await plan()).toEqual([]);

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
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const plan = async () => {
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
			const app = appItems(await remote.state());
			return [...planProjectPush(projects, app), ...planTaskPush(tasks, links, app, { now: new Date() })];
		};
		const deps = { remote, app: appItems([]), ...vaultWriters(memoryVault(files).vault) };

		const first = await plan();
		expect(first.map((c) => c.title).sort()).toEqual(
			[`Tâches ${stamp}`, "Bug à valider", "Tâche de réunion", "Étape héritée", "Étape urgente"].sort(),
		);
		expect(await runPush(first, deps)).toEqual({ applied: 5, failed: [] });
		expect(files.get(meetingPath)).toMatch(/^#task p2 Tâche de réunion \^[0-9a-z]{5}\n  notes privées\n/);
		expect(files.get(projectPath)).toMatch(/- \[ \] Étape héritée \^[0-9a-z]{5}\n/);
		expect(await plan()).toEqual([]);

		// Move the meeting Task into a standalone note, check a step, delete the bug (Unplaced: not offered).
		const taskLine = files.get(meetingPath)!.split("\n")[0]!;
		files.set(meetingPath, files.get(meetingPath)!.replace(`${taskLine}\n`, "").replace(/#bug pr .*\n/, ""));
		files.set(`0.inbox/Notes ${stamp}.md`, `${taskLine}\n`);
		files.set(projectPath, files.get(projectPath)!.replace("- [ ] Étape héritée", "- [x] Étape héritée"));
		const second = await plan();
		expect(second.map((c) => c.group).sort()).toEqual(["changed", "changed"]);
		expect(second).toContainEqual(
			expect.objectContaining({
				group: "changed",
				title: "Tâche de réunion",
				diffs: expect.arrayContaining([expect.objectContaining({ field: "project", to: "none" })]),
			}),
		);
		expect(await runPush(second, deps)).toEqual({ applied: 2, failed: [] });
		expect(files.get(projectPath)).toMatch(/- \[x\] \d{4}-\d{2}-\d{2} Étape héritée \^/);
		expect(await plan()).toEqual([]);
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
	it("brings JMJ's priority changes into the vault, refuses P0, and turns a clash into a conflict settled at once", async () => {
		const projectPath = `2.projects/Pull ${stamp}.md`;
		const meeting = `1.meetings/Pull ${stamp}.md`;
		const files = new Map<string, string>([
			[projectPath, "---\npriority: 3\n---\n# Tasks\n- [ ] Étape héritée\n"],
			[meeting, "#task p3 Tâche pull\n#bug p0 En cours pull\n"],
		]);
		const { vault } = memoryVault(files);
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const read = () => {
			const notes = [...files].map(([path, content]) => ({ path, content }));
			return readVaultItems(notes.filter((n) => n.path === projectPath), notes, () => null);
		};
		const plan = async () => planPush(read(), await fetchAppItems(remote), new Date());
		const pull = () => runPull({ remote, files: vault, vault: read() });
		const pick = async (path: string, priority: number) =>
			(
				await fetch(`${url}${path}/priorite`, {
					method: "POST",
					headers: { cookie: `suivi_session=${clientSession}`, "content-type": "application/x-www-form-urlencoded" },
					body: `priority=${priority}&scope=task`,
					redirect: "manual",
				})
			).status;

		expect(await runPush(await plan(), { remote, app: await fetchAppItems(remote), ...vaultWriters(vault) })).toMatchObject({ failed: [] });
		expect(await pull()).toMatchObject({ applied: 0, conflicts: [], failed: [] });
		const idOf = (title: string) => [...files.values()].join("\n").match(new RegExp(`${title} \\^(\\w{5})`))![1]!;
		const task = idOf("Tâche pull");
		const step = idOf("Étape héritée");
		const busy = idOf("En cours pull");

		expect(await pick(`/taches/${task}`, 1)).toBe(303);
		expect(await pick(`/taches/${step}`, 2)).toBe(303);
		expect(await pick(`/taches/${busy}`, 2)).toBe(403);
		expect(await pick(`/taches/${task}`, 0)).toBe(403);
		expect(await pull()).toMatchObject({ applied: 2, conflicts: [], failed: [] });
		expect(files.get(meeting)).toMatch(/^#task p1 Tâche pull \^\w+\n#bug p0 En cours pull/);
		expect(files.get(projectPath)).toContain("- [ ] p2 Étape héritée ^");
		// Client priority pulled, then the plan is empty and nothing is pulled again.
		expect(await plan()).toEqual([]);
		expect(await pull()).toMatchObject({ applied: 0, conflicts: [], failed: [] });

		// The Developer moves it P1 → P4 without pushing; JMJ picks P5 meanwhile.
		files.set(meeting, files.get(meeting)!.replace("#task p1", "#task p4"));
		expect(await pick(`/taches/${task}`, 5)).toBe(303);
		const { applied, conflicts } = await pull();
		expect(applied).toBe(0);
		expect(files.get(meeting)).toContain("#task p4 Tâche pull");
		expect(conflicts.map((c) => [c.mine.label, c.theirs.label])).toEqual([["P4", "P5"]]);
		expect(conflicts[0]!.theirs.by).toEqual(expect.any(String));
		await pickConflict(conflicts[0]!, "mine", { remote, files: vault });
		expect(await pull()).toMatchObject({ applied: 0, conflicts: [], failed: [] });
		expect(await plan()).toEqual([]);
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
		const store = new InboxStore(remote, () => {});
		expect(await store.refresh()).toEqual([]); // no toasts at the first load

		expect((await asClient(`/items/${id}/commentaires`, "body=Une%20question")).status).toBe(303);
		expect((await asClient(`/taches/${id}/priorite`, "priority=1")).status).toBe(303);
		await remote.comment(id, "Ma réponse");

		// The Client's new entries are toasted, not mine.
		const fresh = await store.refresh();
		expect(fresh.filter((e) => e.item?.id === id).map((e) => e.type)).toEqual(["comment.created", "item.updated"]);
		const ours = (s: InboxStore) => s.current.feed.filter((e) => e.item?.id === id && e.unread);
		expect(ours(store).map((e) => e.type)).toEqual(["item.updated", "comment.created"]);
		expect(ours(store)[1]!.comment?.body).toBe("Une question");
		expect(store.unreadByItem().has(id)).toBe(true);

		await store.markRead(ours(store)[1]!);
		const restarted = new InboxStore(remote, () => {});
		await restarted.refresh();
		expect(ours(restarted).map((e) => e.type)).toEqual(["item.updated"]);
		await restarted.markAllRead();
		await store.refresh();
		expect(store.current.unread).toBe(0);
	});
});

describe.skipIf(!url || !token || !clientSession)("Tickets and Triage against a running Suivi", () => {
	it("JMJ's Bug reaches À trier after a Pull; Insérer ici writes its line and the same item becomes a Task", async () => {
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const title = `Ticket ${stamp}`;
		const res = await fetch(`${url}/demandes`, {
			method: "POST",
			headers: { cookie: `suivi_session=${clientSession}`, "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ title, type: "bug", urgency: "genant", description: "Rien ne s'affiche ![](/uploads/x.png)" }).toString(),
			redirect: "manual",
		});
		expect(res.status).toBe(303);
		const id = res.headers.get("location")!.replace("/demandes?envoyee=", "");
		await remote.comment(id, "Je regarde");

		const store = new InboxStore(remote, () => {});
		await store.refresh();
		const entry = store.current.toTriage.find((e) => e.item.id === id)!;
		expect(entry).toMatchObject({ kind: "ticket", ticketType: "bug", detail: "Rien ne s'affiche ![](/uploads/x.png)" });

		const note = ["# Réunion", "", "suite"];
		const result = await runTriage(entry.item, { type: "bug", priority: 2 }, {
			remote,
			target: () => ({ path: "1.meetings/r.md", projectId: null, step: false }),
			appUrl: url,
			insert: (line) => {
				const at = placeLine(note, 1, line);
				note.splice(1, 1, ...at.text.split("\n"));
			},
		});
		expect(result).toEqual({ ok: true, line: `#bug p2 ${title} ^${id}`, missingImages: 1 });
		expect(note).toEqual(["# Réunion", `#bug p2 ${title} ^${id}`, `\tRien ne s'affiche ![](${url.replace(/\/+$/, "")}/uploads/x.png)`, "", "suite"]);

		await store.refresh();
		expect(store.current.toTriage.some((e) => e.item.id === id)).toBe(false);
		expect((await remote.comments(id)).map((c) => c.body)).toEqual(["Je regarde"]);

		// The next Push sees the line as already pushed.
		const local = readTagTasks("1.meetings/r.md", note.join("\n"), null);
		expect(planTaskPush(local, {}, appItems(await remote.state()), { now: new Date() })).toEqual([]);
		// Triaging twice is refused.
		expect(await runTriage(entry.item, { type: "bug", priority: 2 }, noopDeps(remote))).toMatchObject({ ok: false });
	});
});

describe.skipIf(!url || !token || !clientSession)("Ideas against a running Suivi", () => {
	it("JMJ's Idée waits in the app until launched; Nouveau projet creates the file and the same item becomes a Project", async () => {
		const remote = createHttpRemote({ url, token }, fetchTransport);
		const jmj = { cookie: `suivi_session=${clientSession}`, "content-type": "application/x-www-form-urlencoded" };

		const title = `Idee ${stamp}`;
		const res = await fetch(`${url}/demandes`, {
			method: "POST",
			headers: jmj,
			body: new URLSearchParams({ title, type: "idea", description: "Voir les flux" }).toString(),
			redirect: "manual",
		});
		expect(res.status).toBe(303);
		const id = res.headers.get("location")!.replace("/demandes?envoyee=", "");
		await remote.comment(id, "Bonne idée");

		const store = new InboxStore(remote, () => {});
		const inToTriage = async () => {
			await store.refresh();
			return store.current.toTriage.find((e) => e.item.id === id);
		};
		expect(await inToTriage()).toBeUndefined();

		const launch = await fetch(`${url}/idees/${id}/lancer`, { method: "POST", headers: jmj, redirect: "manual" });
		expect(launch.status).toBe(303);
		const entry = (await inToTriage())!;
		expect(entry).toMatchObject({ kind: "ticket", ticketType: "idea", detail: "Voir les flux" });

		const vault = new Map<string, string>();
		const result = await runNewProject(entry.item, { priority: 4 }, {
			remote,
			folder: "2.projects",
			template: async () => "---\npriority: 5\n---\n\n# Time usage\n---\n```project\n```\n\n# Tasks\n---",
			exists: (p) => vault.has(p),
			create: async (p, c) => void vault.set(p, c),
			appUrl: url,
		});
		const path = `2.projects/${title}.md`;
		expect(result).toEqual({ ok: true, path });
		expect(await inToTriage()).toBeUndefined();
		expect((await remote.comments(id)).map((c) => c.body)).toEqual(["Bonne idée"]);

		// The next Push sees the file as already pushed.
		const read = readSharedProject(path, vault.get(path)!);
		expect(read).toMatchObject({ ok: true, project: { suiviId: id } });
		expect(planProjectPush([(read as { project: SharedProject }).project], appItems(await remote.state()))).toEqual([]);

		const ideas = await (await fetch(`${url}/demandes`, { headers: jmj })).text();
		expect(ideas).toContain(`href="/projets/${id}?depuis=demandes"`);
		expect(ideas).toContain("Lancée");
	});
});


function noopDeps(remote: ReturnType<typeof createHttpRemote>) {
	return {
		remote,
		target: () => ({ path: "x.md", projectId: null, step: false }),
		appUrl: url,
		insert: () => {
			throw new Error("must not write");
		},
	};
}
