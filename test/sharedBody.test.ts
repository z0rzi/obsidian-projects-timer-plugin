import { describe, expect, it } from "vitest";
import { shareBody } from "../src/sync/sharedBody";

describe("Task body as shared with Suivi", () => {
	it("uploads embedded images once and links them; wikilinks become plain text", async () => {
		const uploads: string[] = [];
		const upload = async (link: string) => {
			uploads.push(link);
			return `/uploads/${uploads.length}.png`;
		};
		const body = [
			"Voir [[Widget saison]] et [[Widget saison|le widget]], section [[Widget saison#Export]].",
			"![[capture 1.png]]",
			"![[capture 1.png|300]] puis ![[schema.webp]]",
			"![[Autre note]]",
			"https://www.loom.com/share/0123456789abcdef",
		].join("\n");
		expect(await shareBody(body, upload)).toBe(
			[
				"Voir Widget saison et le widget, section Widget saison > Export.",
				"![](/uploads/1.png)",
				"![](/uploads/1.png) puis ![](/uploads/2.png)",
				"Autre note",
				"https://www.loom.com/share/0123456789abcdef",
			].join("\n"),
		);
		expect(uploads).toEqual(["capture 1.png", "schema.webp"]);
	});

	it("leaves code blocks and inline code alone", async () => {
		const body = "```\n[[pas un lien]]\n```\n`[[non plus]]` mais [[oui]]";
		expect(await shareBody(body, async () => "x")).toBe("```\n[[pas un lien]]\n```\n`[[non plus]]` mais oui");
	});
});
