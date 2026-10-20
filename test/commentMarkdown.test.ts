import { describe, expect, it } from "vitest";
import { withAppUrls } from "../src/comments/commentMarkdown";

describe("comment markdown for Obsidian", () => {
	it("points uploaded images and app links at the app", () => {
		expect(withAppUrls("Voir ![](/uploads/abc.png) et [la tâche](/taches/t7f3a)", "https://suivi.test/")).toBe(
			"Voir ![](https://suivi.test/uploads/abc.png) et [la tâche](https://suivi.test/taches/t7f3a)",
		);
	});

	it("leaves absolute links, anchors and plain text alone", () => {
		const body = "[ext](https://ex.com/a) [ancre](#x) [proto](//ex.com) /uploads/pas-un-lien.png";
		expect(withAppUrls(body, "https://suivi.test")).toBe(body);
	});
});
