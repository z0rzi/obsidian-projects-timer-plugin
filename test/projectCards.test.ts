import { describe, expect, it } from "vitest";
import { extractCheckboxItems } from "../src/projectCards";

describe("extractCheckboxItems", () => {
	it("strips the block ID from a Project step's text and keeps it on the item", () => {
		const lines = ["- [ ] Étape ^s1", "- [x] Sans id"];

		expect(extractCheckboxItems(lines, 0, 2)).toEqual([
			{ text: "Étape", line: 0, checked: false, blockId: "s1", raw: "- [ ] Étape ^s1" },
			{ text: "Sans id", line: 1, checked: true, raw: "- [x] Sans id" },
		]);
	});
});
