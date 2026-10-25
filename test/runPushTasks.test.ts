import { describe, expect, it } from "vitest";
import type { PushChange } from "../src/remote/api";
import { localDay } from "../src/localDate";
import { fetchAppItems } from "../src/sync/appState";
import { runPush, vaultWriters } from "../src/sync/runPush";
import { pushWorld } from "./fakeSuivi";

const tetris = "2.projects/Tetris.md";
const refuseTitle = (c: PushChange) => (c.kind === "task" && c.op !== "archive" && c.fields.title === "Refusé" ? "Titre refusé" : undefined);

describe("runPush with Tasks", () => {
	it("creates a Task, writes its block ID and leaves nothing pending", async () => {
		const w = pushWorld({ "m.md": "#task p2 Widget\n" });

		expect(await w.push()).toEqual({ applied: 1, failed: [] });

		const id = w.files.get("m.md")!.match(/^#task p2 Widget \^([a-z0-9]{5})\n$/)![1];
		expect(w.app.received).toMatchObject([[{ op: "create", kind: "task", id }]]);
		expect(await w.plan()).toEqual([]);
	});

	it("shares the body (image uploaded) and keeps the vault text as the base", async () => {
		const w = pushWorld({ "m.md": "#task p2 Widget\n\tVoir ![[capture.png]]\n\t`![[pas une image]]`\n" });

		expect(await w.push()).toEqual({ applied: 1, failed: [] });

		const sent = w.app.received[0]![0] as Extract<PushChange, { op: "create"; kind: "task" }>;
		expect(sent.fields.description).toBe("Voir ![](/uploads/u0.png)\n`![[pas une image]]`");
		expect(sent.base).toMatchObject({ path: "m.md", fields: { description: "Voir ![[capture.png]]\n`![[pas une image]]`" } });
		expect(await w.plan()).toEqual([]);
	});

	it("keeps a Task pending when an image of its body cannot be sent", async () => {
		const w = pushWorld({ "m.md": "#task p2 Widget\n\t![[capture.png]]\n\n#task p2 Autre\n" });
		const pending = await w.plan();
		const deps = {
			remote: w.app.remote,
			app: await fetchAppItems(w.app.remote),
			...vaultWriters(w.vault),
			shareBody: async () => Promise.reject(new Error("image capture.png not found")),
		};

		const outcome = await runPush(pending, deps);

		expect(outcome).toEqual({ applied: 1, failed: [{ title: "Widget", error: "image capture.png not found" }] });
		expect(w.app.received).toMatchObject([[{ fields: { title: "Autre" } }]]);
		expect(await w.plan()).toMatchObject([{ group: "new", title: "Widget" }]);
	});

	it("pushes a new Project before its steps and links them to its new id", async () => {
		const w = pushWorld({ [tetris]: "---\npriority: 3\n---\n# Tasks\n- [ ] p2 Widget\n" });

		expect(await w.push()).toEqual({ applied: 2, failed: [] });

		const projectId = w.files.get(tetris)!.match(/suivi_id: (\w+)/)![1];
		expect(w.app.received).toMatchObject([
			[{ op: "create", kind: "project", id: projectId }],
			[{ op: "create", kind: "task", fields: { project_id: projectId } }],
		]);
		expect(await w.plan()).toEqual([]);
	});

	it("keeps a Task pending when its new Project was not pushed", async () => {
		const w = pushWorld({ [tetris]: "---\npriority: 3\n---\n# Tasks\n- [ ] p2 Widget\n" });
		const onlyTask = (await w.plan()).filter((c) => c.group !== "error" && c.change.kind === "task");

		const outcome = await w.push(onlyTask);

		expect(outcome).toMatchObject({ applied: 0, failed: [{ title: "Widget", error: expect.stringContaining("Tetris") }] });
		expect(w.app.received).toEqual([]);
		expect(await w.plan()).toHaveLength(2);
	});

	it("keeps a rejected Task pending", async () => {
		const w = pushWorld({ "m.md": "#task p2 Refusé\n#task p2 Widget\n" }, [], refuseTitle);

		expect(await w.push()).toEqual({ applied: 1, failed: [{ title: "Refusé", error: "Titre refusé" }] });
		expect(await w.plan()).toMatchObject([{ group: "new", title: "Refusé" }]);
	});

	it("dates a ticked step it sends as done without a date", async () => {
		const w = pushWorld({ [tetris]: "---\nsuivi_id: p0001\npriority: 3\n---\n# Tasks\n- [x] #bug Export ^s1xyz\n" });

		expect(await w.push()).toEqual({ applied: 2, failed: [] });

		expect(w.app.received.flat()).toMatchObject([{ kind: "project" }, { op: "create", id: "s1xyz", fields: { done_on: localDay() } }]);
		expect(w.files.get(tetris)).toContain(`- [x] #bug ${localDay()} Export ^s1xyz`);
		expect(await w.plan()).toEqual([]);
	});

	it("does not send an undated done line whose date could not be written", async () => {
		const note = "---\nsuivi_id: p0001\npriority: 3\n---\n# Tasks\n- [x] #bug Export ^s1xyz\n";
		const w = pushWorld({ [tetris]: note });
		const pending = (await w.plan()).filter((c) => c.group !== "error" && c.change.kind === "task");
		const deps = {
			remote: w.app.remote,
			app: await fetchAppItems(w.app.remote),
			...vaultWriters(w.vault),
			writeDoneDate: () => Promise.reject(new Error("the line changed")),
		};

		const outcome = await runPush(pending, deps);

		expect(outcome).toMatchObject({ applied: 0, failed: [{ title: "Export", error: expect.stringContaining("the line changed") }] });
		expect(w.app.received).toEqual([]);
		expect(w.files.get(tetris)).toBe(note);
	});
});

describe("runPush dates a step ticked after it was pushed", () => {
	it("sends today's date with Done and writes it into the line", async () => {
		const w = pushWorld({ [tetris]: "---\npriority: 3\n---\n# Tasks\n- [ ] #bug Export\n" });
		await w.push();
		w.files.set(tetris, w.files.get(tetris)!.replace("- [ ] #bug Export", "- [x] #bug Export"));

		expect(await w.push()).toEqual({ applied: 1, failed: [] });

		expect(w.app.received.at(-1)).toMatchObject([{ op: "update", fields: { done: true, done_on: localDay() } }]);
		expect(w.files.get(tetris)).toContain(`- [x] #bug ${localDay()} Export ^`);
		expect(await w.plan()).toEqual([]);
	});
});
