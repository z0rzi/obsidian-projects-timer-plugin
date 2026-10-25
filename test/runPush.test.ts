import { describe, expect, it } from "vitest";
import type { PushChange } from "../src/remote/api";
import { RemoteError, type Remote } from "../src/remote/remote";
import { runPush, type PushDeps } from "../src/sync/runPush";
import { readVaultItems } from "../src/sync/planPush";
import { appProject, pushWorld } from "./fakeSuivi";

const project = (priority = 2) => `---\npriority: ${priority}\n---\n`;
const refuseTitle = (c: PushChange) => (c.op !== "archive" && c.fields.title === "Refusé" ? "Titre refusé" : undefined);
/** Deps whose vault writers do nothing. */
const deps = (w: ReturnType<typeof pushWorld>, over: Partial<PushDeps> = {}): PushDeps => ({
	remote: w.app.remote,
	app: { projects: {}, tasks: {}, withBase: new Set() },
	writeSuiviId: async () => {},
	writeBlockId: async () => {},
	writeDoneDate: async () => {},
	...over,
});

describe("runPush", () => {
	it("creates new Projects, writes their suivi_id and leaves nothing pending", async () => {
		const w = pushWorld({ "2.projects/Widget.md": project(), "2.projects/Talon.md": project(0) });

		expect(await w.push()).toEqual({ applied: 2, failed: [] });

		expect(w.files.get("2.projects/Widget.md")).toMatch(/^---\npriority: 2\nsuivi_id: [a-z0-9]{5}\n---\n/);
		expect(await w.plan()).toEqual([]);
	});

	it("pushes a Project made Done, then reopened with its Priority", async () => {
		const path = "2.projects/Widget.md";
		const w = pushWorld({ [path]: project() });
		await w.push();
		w.files.set(path, w.files.get(path)!.replace("priority: 2", "priority: 2\narchived: true"));
		expect(await w.push()).toEqual({ applied: 1, failed: [] });
		expect(w.app.received.at(-1)).toMatchObject([{ op: "update", fields: { done: true } }]);
		expect(w.app.received.at(-1)![0]).not.toHaveProperty("fields.priority");

		w.files.set(path, w.files.get(path)!.replace("archived: true", "archived: false"));
		expect(await w.push()).toEqual({ applied: 1, failed: [] });
		expect(w.app.received.at(-1)).toMatchObject([{ op: "update", fields: { priority: 2, done: false } }]);
		expect(await w.plan()).toEqual([]);
	});

	it("reopens a Tag task outside any Project with its Priority", async () => {
		const w = pushWorld({ "m.md": "#task p2 Export\n" });
		await w.push();
		const id = w.files.get("m.md")!.match(/\^(\w+)/)![1]!;
		w.files.set("m.md", `#done 2026-10-20 Export ^${id}\n`);
		await w.push();
		w.files.set("m.md", `#task p2 Export ^${id}\n`);
		expect(await w.push()).toEqual({ applied: 1, failed: [] });
		expect(w.app.received.at(-1)).toMatchObject([{ op: "update", fields: { priority: 2, done: false } }]);
		expect(await w.plan()).toEqual([]);
	});

	it("keeps unticked changes pending and pushes them next time", async () => {
		const w = pushWorld({ "2.projects/A.md": project(), "2.projects/B.md": project() });
		await w.push();
		w.files.set("2.projects/A.md", w.files.get("2.projects/A.md")!.replace("priority: 2", "priority: 1"));
		w.files.set("2.projects/B.md", w.files.get("2.projects/B.md")!.replace("priority: 2", "priority: pr"));

		const pending = await w.plan();
		await w.push(pending.filter((c) => c.title === "A"));

		expect(w.app.received.at(-1)).toMatchObject([{ op: "update", kind: "project", fields: { priority: 1 }, expected: { priority: 2 } }]);
		expect(await w.plan()).toMatchObject([
			{ group: "changed", title: "B", diffs: [{ field: "priority", from: 2, to: "pr" }] },
		]);
	});

	it("reports a change the app rejected and keeps it pending, applying the others", async () => {
		const w = pushWorld({ "2.projects/Refusé.md": project(), "2.projects/Accepté.md": project() }, [], refuseTitle);

		const outcome = await w.push();

		expect(outcome).toEqual({ applied: 1, failed: [{ title: "Refusé", error: "Titre refusé" }] });
		// Its id was written first: the next Push creates it keeping that id.
		const id = w.files.get("2.projects/Refusé.md")!.match(/suivi_id: (\w+)/)![1];
		expect(await w.plan()).toMatchObject([{ group: "new", id, title: "Refusé" }]);
	});

	it("reports a create the app answered with another id", async () => {
		const w = pushWorld({ "2.projects/Widget.md": project() });
		const pending = await w.plan();
		const remote = { ...w.app.remote, push: async (changes: PushChange[]) => changes.map(() => ({ ok: true as const, id: "other" })) };

		const outcome = await runPush(pending, deps(w, { remote }));

		expect(outcome).toMatchObject({ applied: 0, failed: [{ title: "Widget", error: expect.stringContaining("other") }] });
	});

	it("does not create a Project whose suivi_id could not be written", async () => {
		const w = pushWorld({ "2.projects/Widget.md": project() });
		const pending = await w.plan();

		const outcome = await runPush(pending, deps(w, { writeSuiviId: async () => Promise.reject(new Error("file locked")) }));

		expect(outcome).toMatchObject({ applied: 0, failed: [{ title: "Widget", error: expect.stringContaining("file locked") }] });
		expect(w.app.received).toEqual([]);
	});

	it("changes nothing when the app refuses the token", async () => {
		const w = pushWorld({ "2.projects/Widget.md": project() });
		const pending = await w.plan();
		const refusing = {
			...w.app.remote,
			push: async () => {
				throw new RemoteError("auth", "Suivi a refusé le jeton API.");
			},
		} as Remote;

		await expect(runPush(pending, deps(w, { remote: refusing }))).rejects.toMatchObject({ kind: "auth" });
		expect(w.app.held.size).toBe(0);
	});

	it("does not call the app when nothing is ticked", async () => {
		const w = pushWorld({ "2.projects/Widget.md": project() });

		expect(await w.push([])).toEqual({ applied: 0, failed: [] });
		expect(w.app.received).toEqual([]);
	});
});

describe("runPush: due_date", () => {
	const dated = (dueDate: string | null) => `---\npriority: 2\n${dueDate === null ? "" : `due_date: ${dueDate}\n`}---\n`;
	const held = (w: ReturnType<typeof pushWorld>) => [...w.app.held.values()][0]!;

	it("creates the Project with its Échéance and stores it in the Base", async () => {
		const w = pushWorld({ "2.projects/Widget.md": dated("2027-01") });

		await w.push();

		expect(w.app.received[0]).toMatchObject([{ op: "create", fields: { due_date: "2027-01" } }]);
		expect(held(w).base).toMatchObject({ fields: { due_date: "2027-01" } });
		expect(await w.plan()).toEqual([]);
	});

	it("sends a set, changed or cleared Échéance with the app value it expects", async () => {
		const w = pushWorld({ "2.projects/Widget.md": dated(null) });
		await w.push();
		const id = w.files.get("2.projects/Widget.md")!.match(/suivi_id: (\w+)/)![1];
		const edit = (from: string, to: string) =>
			w.files.set("2.projects/Widget.md", w.files.get("2.projects/Widget.md")!.replace(from, to));

		edit("priority: 2", "priority: 2\ndue_date: 2027-01");
		expect(await w.plan()).toMatchObject([{ group: "changed", diffs: [{ field: "due_date", from: null, to: "2027-01" }] }]);
		await w.push();
		edit("due_date: 2027-01", "due_date: 2027-02");
		await w.push();
		edit("due_date: 2027-02", "due_date:");
		await w.push();

		expect(w.app.received.slice(1)).toEqual([
			[expect.objectContaining({ id, fields: { due_date: "2027-01" }, expected: { due_date: null } })],
			[expect.objectContaining({ id, fields: { due_date: "2027-02" }, expected: { due_date: "2027-01" } })],
			[expect.objectContaining({ id, fields: { due_date: null }, expected: { due_date: "2027-02" } })],
		]);
		expect(held(w).base).toMatchObject({ fields: { due_date: null } });
		expect(await w.plan()).toEqual([]);
	});

	it("skips the Project while its due_date is a day, not a month, saying why and naming the note", async () => {
		const note = { path: "2.projects/Widget.md", content: dated("2027-01-15") };
		const w = pushWorld({ [note.path]: note.content });

		expect(readVaultItems([note], [note], () => null).skipped).toEqual([
			'Push skips Widget: Invalid due_date "2027-01-15" in 2.projects/Widget.md',
		]);
		expect(await w.plan()).toEqual([]);
	});

	it("never sends a prive Project's Échéance", async () => {
		const w = pushWorld({ "2.projects/Widget.md": "---\nprive: true\ndue_date: 2027-01\n---\n" });

		expect(await w.plan()).toEqual([]);
	});

	it("offers nothing for a Project whose Base predates the Échéance and has none", async () => {
		const fields = { title: "Widget", description: "", priority: 2, done: false };
		const w = pushWorld({ "2.projects/Widget.md": "---\npriority: 2\nsuivi_id: t7f3a\n---\n" }, [
			appProject("t7f3a", fields, { base: { path: "2.projects/Widget.md", fields } }),
		]);

		expect(await w.plan()).toEqual([]);
	});
});

