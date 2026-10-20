import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { extractCheckboxItems, parseProjectCard } from "../src/projectCards";

describe("extractCheckboxItems", () => {
	it("strips the block ID from a Project step's text and keeps it on the item", () => {
		const lines = ["- [ ] Étape ^s1", "- [x] Sans id"];

		expect(extractCheckboxItems(lines, 0, 2)).toEqual([
			{ text: "Étape", line: 0, checked: false, blockId: "s1", raw: "- [ ] Étape ^s1" },
			{ text: "Sans id", line: 1, checked: true, raw: "- [x] Sans id" },
		]);
	});

	it("reads a token on a Project step as an Override", () => {
		const [item] = extractCheckboxItems(["- [ ] p1 fix the x axis ^t91c2"], 0, 1);

		expect(item).toEqual({
			text: "fix the x axis",
			line: 0,
			checked: false,
			blockId: "t91c2",
			override: { priority: 1, status: "priority" },
			raw: "- [ ] p1 fix the x axis ^t91c2",
		});
	});

	it("reads p0 as in progress and pr as awaiting validation", () => {
		const items = extractCheckboxItems(["- [ ] p0 En cours", "- [ ] pr Export CSV"], 0, 2);

		expect(items.map((i) => i.override)).toEqual([
			{ priority: 0, status: "priority" },
			{ priority: 1, status: "review" },
		]);
		expect(items.map((i) => i.text)).toEqual(["En cours", "Export CSV"]);
	});

	it.each(["P1 Titre", "p7 Titre", "pr1 Titre", "Étape2 du calcul"])(
		"does not read a non-token first word as an Override: %s",
		(text) => {
			const [item] = extractCheckboxItems([`- [ ] ${text}`], 0, 1);
			expect(item!.override).toBeUndefined();
			expect(item!.text).toBe(text);
		},
	);
});
