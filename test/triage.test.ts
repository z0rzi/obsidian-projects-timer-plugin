import { describe, expect, it } from "vitest";
import { InboxStore } from "../src/inbox/inboxStore";
import { placeLine, runTriage, type TriageDeps } from "../src/inbox/triage";
import type { InboxTicket, TaskFields, TriageRequest } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import type { SyncState } from "../src/sync/pluginData";

const ticket = (id = "t7f3a", type: InboxTicket["type"] = "bug"): InboxTicket => ({
	id,
	type,
	title: "Heatmap vide",
	description: "Rien ne s'affiche",
	created_at: "2026-10-20T10:00:00.000Z",
	author_email: "jmj@edf.fr",
});

describe("Inbox À trier", () => {
	it("lists the Tickets to triage first, with their description", async () => {
		const remote = {
			inbox: async () => ({ notifications: [], to_triage: [ticket()] }),
			activity: async () => ({ entries: [], next: null }),
		} as unknown as Remote;
		const store = new InboxStore(remote, () => ({}), () => {});
		await store.refresh();

		expect(store.current.toTriage).toEqual([
			expect.objectContaining({
				kind: "ticket",
				ticketType: "bug",
				title: "Bug: Heatmap vide",
				detail: "Rien ne s'affiche",
				by: "jmj@edf.fr",
				item: { kind: "task", id: "t7f3a", title: "Heatmap vide" },
			}),
		]);
	});

	it("copes with an app answer without to_triage", async () => {
		const remote = {
			inbox: async () => ({ notifications: [] }),
			activity: async () => ({ entries: [], next: null }),
		} as unknown as Remote;
		const store = new InboxStore(remote, () => ({}), () => {});
		await store.refresh();
		expect(store.current.toTriage).toEqual([]);
	});
});

describe("placeLine", () => {
	it("writes on the cursor's line when it is blank", () => {
		expect(placeLine(["a", "", ""], 1, "#bug p2 X ^t7f3a")).toEqual({
			from: { line: 1, ch: 0 },
			to: { line: 1, ch: 0 },
			text: "#bug p2 X ^t7f3a",
		});
	});

	it("goes below a non-blank line", () => {
		expect(placeLine(["#task p1 Y", ""], 0, "#bug p2 X ^t7f3a")).toEqual({
			from: { line: 0, ch: 10 },
			to: { line: 0, ch: 10 },
			text: "\n#bug p2 X ^t7f3a",
		});
	});

	it("keeps a blank line before following text, so it doesn't become the Task's body", () => {
		expect(placeLine(["intro", "suite"], 0, "#bug p2 X").text).toBe("\n#bug p2 X\n");
		expect(placeLine(["", "suite"], 0, "#bug p2 X").text).toBe("#bug p2 X\n");
	});
});

function deps(overrides: Partial<TriageDeps> = {}) {
	const sent: [string, TriageRequest][] = [];
	const inserted: string[] = [];
	const sync: SyncState = { pushedProjects: {}, pushedTasks: {} };
	let saved = 0;
	const d: TriageDeps = {
		remote: {
			async triage(id, as) {
				sent.push([id, as]);
				const fields: TaskFields = {
					title: "Heatmap vide",
					type: as.type,
					status: as.priority === 0 ? "en_cours" : "a_faire",
					priority: as.priority,
					project_id: as.project_id,
					description: "Rien ne s'affiche",
				};
				return { id, as: "task", fields };
			},
		},
		sync,
		save: async () => {
			saved++;
		},
		target: () => ({ path: "2.projects/Widget.md", projectId: "p1abc" }),
		insert: (line) => inserted.push(line),
		...overrides,
	};
	return { d, sent, inserted, sync, saved: () => saved };
}

describe("runTriage (Insérer ici)", () => {
	it("triages in the app, writes the Tag task line with the id, and records it as pushed", async () => {
		const { d, sent, inserted, sync, saved } = deps();
		const result = await runTriage({ id: "t7f3a", title: "Heatmap vide" }, { type: "bug", priority: 2 }, d);

		expect(result).toEqual({ ok: true, line: "#bug p2 Heatmap vide ^t7f3a" });
		expect(sent).toEqual([["t7f3a", { as: "task", type: "bug", priority: 2, project_id: "p1abc" }]]);
		expect(inserted).toEqual(["#bug p2 Heatmap vide ^t7f3a"]);
		expect(sync.pushedTasks.t7f3a).toEqual({
			path: "2.projects/Widget.md",
			fields: { title: "Heatmap vide", type: "bug", status: "a_faire", priority: 2, project_id: "p1abc", description: "Rien ne s'affiche" },
		});
		expect(saved()).toBe(1);
	});

	it("keeps the title on one line", async () => {
		const { d, inserted } = deps();
		await runTriage({ id: "t7f3a", title: "Heatmap\n  vide " }, { type: "task", priority: 0 }, d);
		expect(inserted).toEqual(["#task p0 Heatmap vide ^t7f3a"]);
	});

	it("does nothing without a note to write in", async () => {
		const { d, sent, inserted } = deps({ target: () => ({ error: "Open the note where the Task goes." }) });
		const result = await runTriage({ id: "t7f3a", title: "X" }, { type: "bug", priority: 2 }, d);
		expect(result).toEqual({ ok: false, error: "Open the note where the Task goes." });
		expect(sent).toEqual([]);
		expect(inserted).toEqual([]);
	});

	it("writes nothing when the app refuses", async () => {
		const { d, inserted, sync } = deps({
			remote: {
				triage: async () => {
					throw new Error("Suivi error (HTTP 409): Pas à trier : t7f3a");
				},
			},
		});
		const result = await runTriage({ id: "t7f3a", title: "X" }, { type: "bug", priority: 2 }, d);
		expect(result).toEqual({ ok: false, error: "Suivi error (HTTP 409): Pas à trier : t7f3a" });
		expect(inserted).toEqual([]);
		expect(sync.pushedTasks).toEqual({});
	});
});
