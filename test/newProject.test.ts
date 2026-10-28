import { describe, expect, it } from "vitest";
import { InboxStore } from "../src/inbox/inboxStore";
import { projectFile } from "../src/inbox/newProject";
import type { ProjectFields } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";

const IDEA = { id: "i4k2z", title: "Carte des flux", description: "Voir les flux\n\n![](/uploads/abc.png)\n[plan.pdf](/uploads/plan.pdf)" };

describe("projectFile (the Project-note creator)", () => {
	it("writes priority: but no status:, and archived: true without a Priority for a Done Project", () => {
		const open = projectFile("", "X", "xxxxx", { title: "X", description: "", priority: "pr", done: false });
		expect(open).toContain("priority: pr\n");
		expect(open).not.toContain("status:");
		const done = projectFile("", "X", "xxxxx", { title: "X", description: "", priority: null, done: true });
		expect(done).toContain("archived: true\n");
		expect(done).not.toContain("priority:");
	});

	it("fills {{date}} with the local day, not the UTC one", () => {
		const fields: ProjectFields = { title: "X", description: "", priority: 3, done: false };
		// 23:30 UTC on the 21st is already the 22nd in Paris.
		const content = projectFile("created {{date}}", "X", "xxxxx", fields, new Date("2026-10-21T23:30:00Z"));
		expect(content).toContain("created 2026-10-22");
	});
});

describe("Inbox À trier with a Nouveau chantier", () => {
	it("lists it as an Idée to triage, like any Ticket", async () => {
		const to_triage = [{ ...IDEA, type: "idea", created_at: "2026-10-20T10:00:00.000Z", author_email: "jmj@edf.fr", urgency: null, requested_priority: null, project_id: null, zone_id: null }];
		const remote = {
			inbox: async () => ({ notifications: [], to_triage }),
			activity: async () => ({ entries: [], next: null }),
		} as unknown as Remote;
		const store = new InboxStore(remote, () => {});
		await store.refresh();
		expect(store.current.toTriage).toEqual([
			expect.objectContaining({ kind: "ticket", ticketType: "idea", title: "Idée: Carte des flux" }),
		]);
	});
});
