import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { extractCheckboxItems, parseProjectCard } from "../src/projectCards";

describe("extractCheckboxItems", () => {
	it("strips the block ID from a Project step's text and keeps it on the item", () => {
		const lines = ["- [ ] Étape ^s1", "- [x] Sans id"];

		expect(extractCheckboxItems(lines, 0, 2)).toEqual([
			{ text: "Étape", line: 0, checked: false, type: "task", blockId: "s1", raw: "- [ ] Étape ^s1", body: "" },
			{ text: "Sans id", line: 1, checked: true, type: "task", raw: "- [x] Sans id", body: "" },
		]);
	});

	it("reads the indented lines under a step as its body, ending at indent zero", () => {
		const lines = ["- [ ] Étape", "  détail", "", "  - [ ] sous-étape", "- [ ] Autre", "# Time usage"];
		expect(extractCheckboxItems(lines, 0, 6).map((i) => i.body)).toEqual(["  détail\n\n  - [ ] sous-étape", ""]);
	});

	it("reads a token on a Project step as an Override", () => {
		const [item] = extractCheckboxItems(["- [ ] p1 fix the x axis ^t91c2"], 0, 1);

		expect(item).toEqual({
			text: "fix the x axis",
			line: 0,
			checked: false,
			type: "task",
			blockId: "t91c2",
			override: { priority: 1, status: "priority" },
			raw: "- [ ] p1 fix the x axis ^t91c2",
			body: "",
		});
	});

	it("reads p0 as in progress and pr as awaiting validation", () => {
		const items = extractCheckboxItems(["- [ ] p0 En cours", "- [ ] pr Export CSV"], 0, 2);

		expect(items.map((i) => i.override)).toEqual([
			{ priority: 0, status: "priority" },
			{ priority: 1, status: "a_valider" },
		]);
		expect(items.map((i) => i.text)).toEqual(["En cours", "Export CSV"]);
	});

	it("reads a type tag right after the checkbox, then the token", () => {
		const items = extractCheckboxItems(
			["- [ ] #bug p2 Axe faux ^t1", "- [x] #quick Relire", "- [ ] #wait pr Retour JMJ", "- [ ] #task Écrire", "- [ ] #done Pas un type"],
			0,
			5,
		);

		expect(items.map((i) => [i.type, i.override?.priority ?? null, i.text])).toEqual([
			["bug", 2, "Axe faux"],
			["quick", null, "Relire"],
			["wait", 1, "Retour JMJ"],
			["task", null, "Écrire"],
			["task", null, "#done Pas un type"],
		]);
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

describe("parseProjectCard Overrides", () => {
	const file = { path: "2.projects/Heatmap.md", basename: "Heatmap" } as TFile;
	const content = (steps: string[]) =>
		["---", "priority: 4", "---", "", "# Tasks", ...steps].join("\n");

	it("lists an overriding step as an Override and keeps it on the Project card", () => {
		const card = parseProjectCard({ file, content: content(["- [ ] p1 Titre", "- [ ] Sans token"]) })!;

		expect(card.overrides.map((i) => [i.text, i.override])).toEqual([
			["Titre", { priority: 1, status: "priority" }],
		]);
		expect(card.items.map((i) => i.text)).toEqual(["Titre", "Sans token"]);
	});

	it("keeps a step without token only on the Project card", () => {
		const card = parseProjectCard({ file, content: content(["- [ ] Titre"]) })!;

		expect(card.overrides).toEqual([]);
		expect(card.items.map((i) => i.text)).toEqual(["Titre"]);
	});

	it("drops a checked Override from the Overrides, leaving it checked on the Project card", () => {
		const card = parseProjectCard({ file, content: content(["- [x] p1 Titre"]) })!;

		expect(card.overrides).toEqual([]);
		expect(card.items.map((i) => [i.text, i.checked])).toEqual([["Titre", true]]);
	});

	it("lists every Override even past the card preview", () => {
		const steps = ["a", "b", "c", "d"].map((t) => `- [ ] Étape ${t}`).concat("- [ ] p2 Cinquième");
		const card = parseProjectCard({ file, content: content(steps) })!;

		expect(card.items).toHaveLength(3);
		expect(card.overrides.map((i) => i.text)).toEqual(["Cinquième"]);
	});
});
