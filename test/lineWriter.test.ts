import { describe, expect, it } from "vitest";
import { splitBlockId } from "../src/blockId";
import { rewriteTaskTag, toggleCheckbox } from "../src/lineWriter";

describe("splitBlockId", () => {
	it("strips a trailing block ID from the text", () => {
		expect(splitBlockId("Titre ^t7f3a")).toEqual({ text: "Titre", blockId: "t7f3a" });
	});

	it("leaves text without a block ID untouched", () => {
		expect(splitBlockId("Titre ^ pas un id")).toEqual({ text: "Titre ^ pas un id" });
	});
});

describe("rewriteTaskTag", () => {
	it("finds the Task by block ID after lines were inserted above it", () => {
		const loaded = "#task p2 Titre ^t7f3a";
		const content = ["intro", "ajout 1", "ajout 2", loaded, "", "#task p1 Autre"].join("\n");

		const result = rewriteTaskTag(content, { line: 1, raw: loaded, blockId: "t7f3a" }, "#done 2026-10-20");

		expect(result).toEqual({
			ok: true,
			content: ["intro", "ajout 1", "ajout 2", "#done 2026-10-20 Titre ^t7f3a", "", "#task p1 Autre"].join("\n"),
		});
	});

	it("refuses to write when a Task without ID no longer sits on its line", () => {
		const content = ["#task p1 Autre", "#task p2 Titre"].join("\n");

		const result = rewriteTaskTag(content, { line: 0, raw: "#task p2 Titre" }, "#done 2026-10-20");

		expect(result).toEqual({ ok: false, reason: "changed" });
	});

	it("keeps the block ID when the priority changes", () => {
		const content = "#task p2 Titre ^t7f3a";

		const result = rewriteTaskTag(content, { line: 0, raw: content, blockId: "t7f3a" }, "#task p4");

		expect(result).toEqual({ ok: true, content: "#task p4 Titre ^t7f3a" });
	});

	it("writes a Task without ID that is still on its line", () => {
		const content = ["intro", "#bug p3 Plantage"].join("\n");

		const result = rewriteTaskTag(content, { line: 1, raw: "#bug p3 Plantage" }, "#bug p0");

		expect(result).toEqual({ ok: true, content: ["intro", "#bug p0 Plantage"].join("\n") });
	});
});

describe("rewriteTaskTag status token", () => {
	it.each(["PR de refacto", "P2 Titre", "p7 Titre", "Étape2 du calcul"])(
		"keeps a title starting with a non-token word: %s",
		(title) => {
			const raw = `#task ${title}`;
			expect(rewriteTaskTag(raw, { line: 0, raw }, "#task pr")).toEqual({
				ok: true,
				content: `#task pr ${title}`,
			});
		},
	);

	it("replaces an existing pr token", () => {
		const raw = "#task pr Titre";
		expect(rewriteTaskTag(raw, { line: 0, raw }, "#task p0")).toEqual({ ok: true, content: "#task p0 Titre" });
	});
});

describe("toggleCheckbox", () => {
	it("toggles the Project step found by block ID and keeps the ID", () => {
		const loaded = "- [ ] Étape ^s1";
		const content = ["# Tasks", "- [ ] Nouvelle", loaded].join("\n");

		const result = toggleCheckbox(content, { line: 1, raw: loaded, blockId: "s1" });

		expect(result).toEqual({ ok: true, content: ["# Tasks", "- [ ] Nouvelle", "- [x] Étape ^s1"].join("\n") });
	});

	it("refuses to toggle a step without ID whose line changed", () => {
		const content = ["# Tasks", "- [ ] Nouvelle", "- [ ] Étape"].join("\n");

		const result = toggleCheckbox(content, { line: 1, raw: "- [ ] Étape" });

		expect(result).toEqual({ ok: false, reason: "changed" });
	});
});
