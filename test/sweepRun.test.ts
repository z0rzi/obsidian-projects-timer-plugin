import { describe, expect, it } from "vitest";
import { frigoTasks, keepTask, moveTask, pushSwept, type SweptLine } from "../src/deck/sweepRun";
import type { SweepCandidate } from "../src/deck/sweep";
import { pushWorld } from "./fakeSuivi";

const daily = "1.meetings/2026-10-01.md";
const widget = "2.projects/Widget.md";

/** A Daily note with three swept lines and a Project note, all pushed: the app agrees with the vault. */
async function world() {
	const w = pushWorld({
		[widget]: "---\nsuivi_id: p0002\npriority: 2\n---\n# Widget\n\n## Tasks\n- [ ] Devis ^s1xyz\n\n## Notes\nRien\n",
		[daily]: [
			"## Triage",
			"#bug p3 Export vide ^t0001",
			"\t[[Widget]]",
			"\tLe bouton ne fait rien",
			"#quick Marge du titre ^t0002",
			"#task p4 Relancer JMJ ^t0003",
			"",
			"## Notes",
			"Réunion",
		].join("\n"),
	});
	expect((await w.push()).failed).toEqual([]);
	expect(await w.plan()).toEqual([]);
	const swept = (id: string): SweepCandidate => {
		const lines = w.files.get(daily)!.split("\n");
		const line = lines.findIndex((l) => l.endsWith(`^${id}`));
		return { id, path: daily, line, raw: lines[line]!, title: "", type: "bug", priority: 3, description: "", day: "2026-10-01" };
	};
	const push = (lines: SweptLine[]) => pushSwept(lines, { plan: w.plan, push: w.push });
	return { ...w, swept, push };
}

describe("The Sweep's writes", () => {
	it("z writes pz on the line, #quick included, and the closing Push sends them to the Frigo", async () => {
		const w = await world();

		const result = await frigoTasks([w.swept("t0001"), w.swept("t0002")], w.vault);

		expect(result).toEqual({ outcome: { kind: "swept", how: "frigo", passed: 2, done: 2 }, written: ["t0001", "t0002"], errors: [] });
		expect(w.files.get(daily)).toContain("#bug pz Export vide ^t0001\n\t[[Widget]]\n\tLe bouton ne fait rien\n#quick pz Marge du titre ^t0002\n");
		expect(await w.push(result.written)).toEqual({ applied: 2, failed: [] });
		expect(w.app.held.get("t0001")!.fields.priority).toBe("pz");
		expect(w.app.held.get("t0002")!.fields.priority).toBe("pz");
		expect(await w.plan()).toEqual([]);
	});

	it("z on a line not Pushed yet writes pz on it, and the closing Push creates it in the Frigo", async () => {
		const w = await world();
		w.files.set(daily, w.files.get(daily)!.replace("## Notes", "#task p3 Nouvelle idée\n\n## Notes"));
		const lines = w.files.get(daily)!.split("\n");
		const line = lines.indexOf("#task p3 Nouvelle idée");
		const fresh: SweepCandidate = { ...w.swept("t0003"), id: null, line, raw: lines[line]! };

		const result = await frigoTasks([fresh], w.vault);

		expect(result).toEqual({ outcome: { kind: "swept", how: "frigo", passed: 1, done: 1 }, written: [{ path: daily, raw: "#task pz Nouvelle idée" }], errors: [] });
		expect(await w.push(result.written)).toEqual({ applied: 1, failed: [] });
		const created = [...w.app.held.values()].find((i) => i.fields.title === "Nouvelle idée")!;
		expect(created.fields.priority).toBe("pz");
		expect(await w.plan()).toEqual([]);
	});

	it("m on a line not Pushed yet moves it as a step, and the closing Push creates it in the Project", async () => {
		const w = await world();
		w.files.set(daily, w.files.get(daily)!.replace("## Notes", "#task p3 Nouvelle idée\n\tSon corps\n\n## Notes"));
		const lines = w.files.get(daily)!.split("\n");
		const line = lines.indexOf("#task p3 Nouvelle idée");
		const fresh: SweepCandidate = { ...w.swept("t0003"), id: null, line, raw: lines[line]! };

		expect(await moveTask(fresh, { path: widget }, w.vault)).toEqual({ kind: "swept", how: "moved", passed: 1, done: 1 });
		expect(w.files.get(daily)).not.toContain("Nouvelle idée");
		expect(w.files.get(widget)).toContain("- [ ] #task p3 Nouvelle idée\n\tSon corps\n");
		expect(await w.push([{ path: widget, raw: "- [ ] #task p3 Nouvelle idée" }])).toEqual({ applied: 1, failed: [] });
		const created = [...w.app.held.values()].find((i) => i.fields.title === "Nouvelle idée")!;
		expect(created.fields).toMatchObject({ project_id: "p0002", step: true, description: "Son corps" });
		expect(await w.plan()).toEqual([]);
	});

	it("reports a line gone from its note and goes on with the others", async () => {
		const w = await world();
		const gone = { ...w.swept("t0001"), id: "t9999" };

		const result = await frigoTasks([gone, w.swept("t0003")], w.vault);

		expect(result.outcome).toEqual({ kind: "swept", how: "frigo", passed: 2, done: 1 });
		expect(result.written).toEqual(["t0003"]);
		expect(result.errors).toEqual(["ligne introuvable dans la note"]);
	});

	it("m moves the line and its body under the Project note's Tasks heading as a step, id kept, the Project link line dropped", async () => {
		const w = await world();

		const projectOf = (link: string) => (link === "Widget" ? widget : null);
		expect(await moveTask(w.swept("t0001"), { path: widget }, w.vault, projectOf)).toEqual({ kind: "swept", how: "moved", passed: 1, done: 1 });

		expect(w.files.get(daily)).toBe(["## Triage", "#quick Marge du titre ^t0002", "#task p4 Relancer JMJ ^t0003", "", "## Notes", "Réunion"].join("\n"));
		expect(w.files.get(widget)).toBe(
			"---\nsuivi_id: p0002\npriority: 2\n---\n# Widget\n\n## Tasks\n- [ ] Devis ^s1xyz\n- [ ] #bug p3 Export vide ^t0001\n\tLe bouton ne fait rien\n\n## Notes\nRien\n",
		);
		expect(await w.push(["t0001"])).toEqual({ applied: 1, failed: [] });
		expect(w.app.held.get("t0001")!.fields).toMatchObject({ project_id: "p0002", step: true, priority: 3, description: "Le bouton ne fait rien" });
		expect(await w.plan()).toEqual([]);
	});

	it("m adds a Tasks heading to a Project note without one; a Rapide becomes a step that inherits", async () => {
		const w = await world();
		w.files.set(widget, "---\nsuivi_id: p0002\npriority: 2\n---\n# Widget\n");

		await moveTask(w.swept("t0002"), { path: widget }, w.vault);

		expect(w.files.get(widget)).toBe("---\nsuivi_id: p0002\npriority: 2\n---\n# Widget\n\n## Tasks\n- [ ] #quick Marge du titre ^t0002\n");
	});

	it("m leaves both notes as they were when the line is gone", async () => {
		const w = await world();
		const before = [w.files.get(daily), w.files.get(widget)];

		expect(await moveTask({ ...w.swept("t0001"), id: "t9999" }, { path: widget }, w.vault)).toMatchObject({ kind: "failed" });
		expect([w.files.get(daily), w.files.get(widget)]).toEqual(before);
	});

	it("Enter posts kept_until, which the state then carries, and writes nothing in the vault", async () => {
		const w = await world();
		const before = w.files.get(daily);

		expect(await keepTask(w.swept("t0003"), "2026-11-04", w.app.remote)).toEqual({ kind: "swept", how: "kept", passed: 1, done: 1 });

		expect((await w.app.remote.fullState()).items.find((i) => i.id === "t0003")).toMatchObject({ kept_until: "2026-11-04" });
		expect(w.files.get(daily)).toBe(before);
	});
});

describe("The Push closing a session", () => {
	it("sends only what the Sweep wrote, not the other changes of the vault", async () => {
		const w = await world();
		const { written } = await frigoTasks([w.swept("t0001")], w.vault);
		w.files.set(daily, w.files.get(daily)!.replace("#task p4 Relancer JMJ", "#task p5 Relancer JMJ"));

		expect(await w.push(written)).toEqual({ applied: 1, failed: [] });
		expect(w.app.held.get("t0003")!.fields.priority).toBe(4);
	});

	it("is silent when the Sweep wrote nothing: no call to the app", async () => {
		const w = await world();
		const calls = w.app.received.length;

		expect(await w.push([])).toBeNull();
		expect(w.app.received.length).toBe(calls);
	});
});
