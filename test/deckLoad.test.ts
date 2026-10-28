import { describe, expect, it } from "vitest";
import { loadSession, type LoadDeps } from "../src/deck/deckLoad";
import { deckScreen, press } from "../src/deck/deckSession";
import type { SweepOptions } from "../src/deck/sweep";
import type { InboxTicket, ItemState, StateResponse } from "../src/remote/api";
import { deckMessage } from "../src/views/deckRender";
import { appTask } from "./fakeSuivi";

const options: SweepOptions = { folder: "1.meetings", format: "YYYY-MM-DD", age: 7, isProject: () => false };
const ticket: InboxTicket = {
	id: "t1",
	type: "bug",
	title: "Heatmap vide",
	description: "",
	created_at: "2026-10-26T13:05:00.000Z",
	author_email: "jmj@edf.fr",
	urgency: "genant",
	requested_priority: null,
	project_id: null,
	zone_id: null,
};
const appState: StateResponse = { items: [{ ...appTask("s1", { title: "Export vide" }), kept_until: null } as ItemState], zones: [], deck_at: null };

/** The day's first session: a Daily note with one old line to sweep, the app's Tickets from `inbox`. */
const deps = (inbox: LoadDeps["inbox"], notes = [{ path: "1.meetings/2026-10-01.md", basename: "2026-10-01", content: "#bug p3 Export vide ^s1", ctime: 0 }]): LoadDeps => ({
	inbox,
	fullState: async () => appState,
	sweep: { options, notes: async () => notes },
	projects: [],
	now: new Date("2026-10-28T09:00:00"),
	notify: () => {},
});

describe("Deck loading", () => {
	it("puts the Sweep before the Tickets on the day's first session", async () => {
		const s = await loadSession(deps(async () => ({ notifications: [], to_triage: [ticket] })));
		expect(s.items.map((i) => i.kind)).toEqual(["sweep", "ticket"]);
		expect(deckMessage(s)).toBeNull();
	});

	it("keeps the Sweep usable when the Tickets can't be read, saying so in red on every screen", async () => {
		const s = await loadSession(deps(() => Promise.reject(new Error("réseau coupé"))));
		expect(s.items.map((i) => i.kind)).toEqual(["sweep"]);
		expect(deckScreen(s)).toBe("sweep");
		const red = { kind: "error", text: "Tickets indisponibles : réseau coupé" };
		expect(deckMessage(s)).toEqual(red);
		expect(deckMessage(press(s, "z").state)).toEqual(red);
		expect(deckScreen(press(press(s, "z").state, "Enter").state)).toBe("end");
		expect(deckMessage(press(press(s, "z").state, "Enter").state)).toEqual(red);
	});

	it("fails as before when the Tickets can't be read and there is nothing to sweep", async () => {
		await expect(loadSession(deps(() => Promise.reject(new Error("réseau coupé")), []))).rejects.toThrow("réseau coupé");
	});
});
