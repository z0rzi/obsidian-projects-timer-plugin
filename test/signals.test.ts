import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../src/remote/api";
import { toastText } from "../src/inbox/signals";

const JMJ: ActivityEntry["actor"] = { email: "jmj@edf.fr", handle: "jmj", role: "client" };

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
	id: 1,
	at: "2026-10-20T10:00:00.000Z",
	actor: JMJ,
	origin: "site",
	type: "comment.created",
	label: "Commentaire",
	item: { kind: "task", id: "t7f3a", title: "Algo détection" },
	unread: true,
	...over,
});

describe("toastText", () => {
	it("names the Client who commented", () => {
		expect(toastText(entry({}))).toBe("JMJ a commenté Algo détection");
	});

	it("capitalises a longer handle, else uses the email's local part", () => {
		const julie = { email: "julie.m@edf.fr", handle: "julie", role: "client" as const };
		expect(toastText(entry({ actor: julie }))).toBe("Julie a commenté Algo détection");
		expect(toastText(entry({ actor: { ...julie, handle: null } }))).toBe("Julie.m a commenté Algo détection");
	});

	it("shows a priority change", () => {
		const item = { kind: "project" as const, id: "p1abc", title: "Prix SPOTS" };
		expect(toastText(entry({ type: "item.updated", item, field: "priority", from: 1, to: 2 }))).toBe(
			"P1 → P2 sur Prix SPOTS",
		);
	});

	it("announces a new ticket and a Review answer", () => {
		expect(toastText(entry({ type: "ticket.created" }))).toBe("Nouveau ticket : Algo détection");
		expect(toastText(entry({ type: "review.answered", answer: "valide" }))).toBe("Revue Algo détection : Validé");
		expect(toastText(entry({ type: "review.answered", answer: "a_reprendre" }))).toBe(
			"Revue Algo détection : À reprendre",
		);
	});

	it("falls back to the app's label for other events", () => {
		expect(toastText(entry({ type: "idea.launched", label: "Idée lancée" }))).toBe("Idée lancée : Algo détection");
	});
});
