import { describe, expect, it } from "vitest";
import type { ProjectFields, TaskFields } from "../src/remote/api";
import { settings } from "./obsidian-stub";
import { UnplacedModal } from "../src/ui/UnplacedModal";
import { InboxStore } from "../src/inbox/inboxStore";
import type { Remote } from "../src/remote/remote";
import { insertUnplacedProject } from "../src/inbox/newProject";
import { insertUnplacedTask } from "../src/inbox/triage";
import { removeFromApp, type UnplacedItem } from "../src/sync/unplaced";
import { appProject, appTask, pushWorld } from "./fakeSuivi";

const meeting = "1.meetings/m.md";
const project = "2.projects/Widget.md";
const heatmap: TaskFields = { title: "Heatmap", type: "task", step: false, priority: 3, done: false, project_id: null, description: "" };
const widget: ProjectFields = { title: "Widget", description: "", priority: 3, done: false };

/** Ids and titles of the Unplaced items the Pull finds. */
async function unplaced(w: ReturnType<typeof pushWorld>) {
	return (await w.pull()).unplaced.map((i) => [i.id, i.fields.title]);
}

describe("Unplaced items", () => {
	it("a deleted Task line becomes Unplaced; archived, untriaged and carried Items don't", async () => {
		const w = pushWorld({ [meeting]: "#task p3 Heatmap ^t7f3a\n" }, [
			appTask("t7f3a", heatmap, { base: { path: meeting, fields: heatmap } }),
			appTask("t0del", { ...heatmap, title: "Deleted" }, { base: { path: meeting, fields: heatmap } }),
			appTask("t0arc", { ...heatmap, title: "Archived" }, { archived: true }),
			appTask("t0tik", { ...heatmap, title: "Ticket", type: "bug", priority: null }, { triaged: false }),
		]);
		expect(await unplaced(w)).toEqual([["t0del", "Deleted"]]);
		w.files.set(meeting, "#task p3 Heatmap ^t7f3a\n#task p3 Deleted ^t0del\n");
		expect(await unplaced(w)).toEqual([]);
	});

	it("a private Project and its steps are Unplaced", async () => {
		const note = "---\nsuivi_id: p0002\nprive: true\npriority: 3\n---\n# Tasks\n- [ ] p3 Export ^s9xyz\n";
		const w = pushWorld({ [project]: note }, [
			appProject("p0002", widget, { base: { path: project, fields: widget } }),
			appTask("s9xyz", { ...heatmap, title: "Export", step: true, project_id: "p0002" }),
		]);
		expect(await unplaced(w)).toEqual([
			["p0002", "Widget"],
			["s9xyz", "Export"],
		]);
	});

	it("leaves out the Items of an unreadable Project note", async () => {
		const note = "---\nsuivi_id: p0002\ndue_date: bof\npriority: 3\n---\n# Tasks\n- [ ] p3 Export ^s9xyz\n";
		const w = pushWorld({ [project]: note }, [
			appProject("p0002", widget, { base: { path: project, fields: widget } }),
			appTask("s9xyz", { ...heatmap, step: true, project_id: "p0002" }),
			appTask("s9old", { ...heatmap, step: true }, { base: { path: project, fields: heatmap } }),
		]);
		expect(await unplaced(w)).toEqual([]);
	});

	it("Insérer ici writes the Task line from the app's fields, keeping its id, and the Push then has nothing", async () => {
		const done = { ...heatmap, title: "Old  fix", type: "bug" as const, priority: null, done: true, description: "Fait\n\tdétail" };
		const w = pushWorld({ [meeting]: "# Notes\n" }, [
			appTask("t0del", { ...done, done_on: "2026-10-01" }, { base: { path: "gone.md", fields: done } }),
		]);
		const [item] = (await w.pull()).unplaced;
		const result = await insertUnplacedTask(item as Extract<UnplacedItem, { kind: "task" }>, {
			remote: w.app.remote,
			target: () => ({ path: meeting, projectId: null, step: false }),
			insert: (text) => w.files.set(meeting, `${w.files.get(meeting)}${text}\n`),
			appUrl: "https://suivi.test",
		});
		expect(result).toMatchObject({ ok: true, line: "#done 2026-10-01 Old fix ^t0del" });
		expect(w.files.get(meeting)).toBe("# Notes\n#done 2026-10-01 Old fix ^t0del\n\tFait\n\t\tdétail\n");
		expect((await w.pull()).unplaced).toEqual([]);
		expect(await w.plan()).toEqual([]);
	});

	it("Insérer ici on a Task acknowledges its outstanding Answer, as the Pull does", async () => {
		const done = { ...heatmap, priority: null, done: true, done_on: "2026-10-20" };
		const answer = { id: 7, answer: "valide" as const, at: "2026-10-20T09:00:00Z", by: "jmj" };
		const w = pushWorld({ [meeting]: "# Notes\n" }, [appTask("t0ans", done, { base: { path: "gone.md", fields: heatmap }, answer })]);
		const [item] = (await w.pull()).unplaced;
		await insertUnplacedTask(item as Extract<UnplacedItem, { kind: "task" }>, {
			remote: w.app.remote,
			target: () => ({ path: meeting, projectId: null, step: false }),
			insert: (text) => w.files.set(meeting, `${w.files.get(meeting)}${text}\n`),
			appUrl: "https://suivi.test",
		});
		expect(w.app.held.get("t0ans")!.answer).toBeNull();
		expect(await w.pull()).toMatchObject({ applied: 0, conflicts: [], unplaced: [] });
		expect(await w.plan()).toEqual([]);
	});

	it("Insérer ici writes a Project step with its token", async () => {
		const step = { ...heatmap, title: "Export", step: true, priority: 2, project_id: "p0002" };
		const note = "---\nsuivi_id: p0002\npriority: 3\nstatus: À faire\n---\n# Tasks\n";
		const w = pushWorld({ [project]: note }, [
			appProject("p0002", widget, { base: { path: project, fields: widget } }),
			appTask("s9xyz", step, { base: { path: project, fields: step } }),
		]);
		const [item] = (await w.pull()).unplaced;
		await insertUnplacedTask(item as Extract<UnplacedItem, { kind: "task" }>, {
			remote: w.app.remote,
			target: () => ({ path: project, projectId: "p0002", step: true }),
			insert: (text) => w.files.set(project, `${w.files.get(project)}${text}\n`),
			appUrl: "https://suivi.test",
		});
		expect(w.files.get(project)).toBe(`${note}- [ ] #task p2 Export ^s9xyz\n`);
		expect(await w.plan()).toEqual([]);
	});

	it("Insérer ici on a Project creates its note with its id, acknowledges its Answer, and the Push then has nothing", async () => {
		const fields = { ...widget, description: "Le widget" };
		const answer = { id: 8, answer: "a_reprendre" as const, at: "2026-10-20T09:00:00Z", by: "jmj" };
		const w = pushWorld({}, [appProject("p0002", fields, { base: { path: "old/Widget.md", fields }, answer })]);
		const [item] = (await w.pull()).unplaced;
		const result = await insertUnplacedProject(item as Extract<UnplacedItem, { kind: "project" }>, {
			remote: w.app.remote,
			folder: "2.projects",
			template: async () => "",
			exists: (path) => w.files.has(path),
			create: async (path, content) => void w.files.set(path, content),
			appUrl: "https://suivi.test",
		});
		expect(result).toEqual({ ok: true, path: project });
		expect(w.files.get(project)).toContain("suivi_id: p0002");
		expect(w.app.held.get("p0002")!.answer).toBeNull();
		expect((await w.pull()).unplaced).toEqual([]);
		expect(await w.plan()).toEqual([]);
	});

	it("Insérer ici on a Project with an Échéance writes its due_date, and the Push then has nothing", async () => {
		const fields = { ...widget, due_date: "2027-01" };
		const w = pushWorld({}, [appProject("p0002", fields, { base: { path: "old/Widget.md", fields } })]);
		const [item] = (await w.pull()).unplaced;
		await insertUnplacedProject(item as Extract<UnplacedItem, { kind: "project" }>, {
			remote: w.app.remote,
			folder: "2.projects",
			template: async () => "",
			exists: (path) => w.files.has(path),
			create: async (path, content) => void w.files.set(path, content),
			appUrl: "https://suivi.test",
		});
		expect(w.files.get(project)).toContain("due_date: 2027-01");
		expect(await w.plan()).toEqual([]);
	});

	it("Retirer de l'app archives the Items and reports the ones refused", async () => {
		const w = pushWorld({}, [appTask("t0del", { ...heatmap, title: "Deleted" }), appProject("p0002", widget)], (c) =>
			c.kind === "project" ? "refusé" : undefined,
		);
		const items = (await w.pull()).unplaced;
		expect(await removeFromApp(w.app.remote, items)).toEqual({ removed: ["t0del"], failed: ["Widget : refusé"] });
		expect(w.app.held.get("t0del")!.archived).toBe(true);
		expect(await unplaced(w)).toEqual([["p0002", "Widget"]]);
	});

	it("the Inbox lists up to 4 Unplaced items singly, from 5 one bulk entry; the ones kept in its modal come back singly", async () => {
		const remote = {
			inbox: async () => ({ notifications: [], to_triage: [] }),
			activity: async () => ({ entries: [], next: null, unread: 0 }),
		} as unknown as Remote;
		const store = new InboxStore(remote, () => {});
		await store.refresh();
		const task = (n: number): UnplacedItem => ({ kind: "task", id: `t000${n}`, fields: { ...heatmap, title: `T${n}`, done_on: null }, projectTitle: "Widget" });
		const items = [1, 2, 3, 4, 5].map(task);

		store.setUnplaced(items.slice(0, 4));
		expect(store.current.unplaced.map((e) => [e.key, e.title, e.detail])).toEqual([
			["ut0001", "T1", "Tâche de Widget"],
			["ut0002", "T2", "Tâche de Widget"],
			["ut0003", "T3", "Tâche de Widget"],
			["ut0004", "T4", "Tâche de Widget"],
		]);
		expect(store.current.unplacedBulk).toEqual([]);

		store.setUnplaced(items);
		expect(store.current.unplaced).toEqual([]);
		expect(store.current.unplacedBulk.map((i) => i.id)).toEqual(["t0001", "t0002", "t0003", "t0004", "t0005"]);

		// The modal removed two and kept three.
		store.keepUnplaced(["t0001", "t0002", "t0003"]);
		store.dropUnplaced(["t0004", "t0005"]);
		expect(store.current.unplaced.map((e) => e.key)).toEqual(["ut0001", "ut0002", "ut0003"]);
		store.setUnplaced([...items.slice(0, 3), ...[6, 7, 8, 9, 10].map(task)]);
		expect(store.current.unplaced.map((e) => e.key)).toEqual(["ut0001", "ut0002", "ut0003"]);
		expect(store.current.unplacedBulk).toHaveLength(5);
	});

	it("the bulk modal's top switch sets every « Retirer »; confirming hands over the switched-on Items", () => {
		const items: UnplacedItem[] = ["A", "B", "C"].map((title, n) => ({ kind: "task", id: `t000${n}`, fields: { ...heatmap, title, done_on: null }, projectTitle: null }));
		const confirmed: UnplacedItem[][] = [];
		settings.length = 0;
		new UnplacedModal({} as never, items, (removed) => confirmed.push(removed)).open();
		const [all, a, b, c, confirm] = settings;
		expect(settings.map((s) => s.name)).toEqual(["Tout retirer", "A", "B", "C", ""]);

		all!.toggle!.setValue(true);
		expect([a, b, c].map((s) => s!.toggle!.value)).toEqual([true, true, true]);
		b!.toggle!.setValue(false);
		confirm!.button!.click();
		expect(confirmed).toEqual([[items[0], items[2]]]);
	});
});
