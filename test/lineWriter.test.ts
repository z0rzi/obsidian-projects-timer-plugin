import { describe, expect, it } from "vitest";
import { splitBlockId } from "../src/blockId";
import { appendBlockId, rewriteStepToken, rewriteTaskTag, setStepDone, setTaskPriority, setTaskToken } from "../src/lineWriter";

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

describe("setStepDone finding the line", () => {
	it("ticks the Project step found by block ID and keeps the ID", () => {
		const loaded = "- [ ] Étape ^s1";
		const content = ["# Tasks", "- [ ] Nouvelle", loaded].join("\n");

		const result = setStepDone(content, { line: 1, raw: loaded, blockId: "s1" }, "2026-10-24");

		expect(result).toEqual({ ok: true, content: ["# Tasks", "- [ ] Nouvelle", "- [x] 2026-10-24 Étape ^s1"].join("\n") });
	});

	it("refuses to tick a step without ID whose line changed", () => {
		const content = ["# Tasks", "- [ ] Nouvelle", "- [ ] Étape"].join("\n");

		const result = setStepDone(content, { line: 1, raw: "- [ ] Étape" }, "2026-10-24");

		expect(result).toEqual({ ok: false, reason: "changed" });
	});
});

describe("rewriteStepToken", () => {
	it("replaces an Override token and keeps the block ID", () => {
		const loaded = "- [ ] p1 Titre ^s1";
		const content = ["# Tasks", "- [ ] Nouvelle", loaded].join("\n");

		const result = rewriteStepToken(content, { line: 1, raw: loaded, blockId: "s1" }, "p0");

		expect(result).toEqual({ ok: true, content: ["# Tasks", "- [ ] Nouvelle", "- [ ] p0 Titre ^s1"].join("\n") });
	});

	it("adds a token to an inheriting step", () => {
		const raw = "- [ ] Titre ^s1";
		expect(rewriteStepToken(raw, { line: 0, raw, blockId: "s1" }, "pr")).toEqual({
			ok: true,
			content: "- [ ] pr Titre ^s1",
		});
	});

	it("removes the token, so the step inherits again", () => {
		const raw = "- [ ] pr Titre ^s1";
		expect(rewriteStepToken(raw, { line: 0, raw, blockId: "s1" }, null)).toEqual({
			ok: true,
			content: "- [ ] Titre ^s1",
		});
	});

	it.each(["P1 Titre", "p7 Titre", "Étape2 du calcul"])("keeps a non-token first word: %s", (title) => {
		const raw = `- [ ] ${title}`;
		expect(rewriteStepToken(raw, { line: 0, raw }, "p2")).toEqual({ ok: true, content: `- [ ] p2 ${title}` });
	});

	it("refuses a step without ID whose line changed", () => {
		const content = ["- [ ] Autre", "- [ ] p1 Titre"].join("\n");
		expect(rewriteStepToken(content, { line: 0, raw: "- [ ] p1 Titre" }, "p2")).toEqual({
			ok: false,
			reason: "changed",
		});
	});

	it("refuses a line that is no longer a checkbox", () => {
		const content = "Titre ^s1";
		expect(rewriteStepToken(content, { line: 0, raw: "- [ ] Titre ^s1", blockId: "s1" }, "p2")).toEqual({
			ok: false,
			reason: "changed",
		});
	});
});

describe("a typed Project step", () => {
	const raw = "- [ ] #bug p2 Axe faux ^s1";
	const ref = { line: 0, raw, blockId: "s1" };

	it("keeps the tag in front when its token is set, added or removed", () => {
		expect(setTaskToken(raw, ref, "p0")).toEqual({ ok: true, content: "- [ ] #bug p0 Axe faux ^s1" });
		expect(setTaskToken(raw, ref, null)).toEqual({ ok: true, content: "- [ ] #bug Axe faux ^s1" });
		const inheriting = "- [ ] #wait Retour JMJ";
		expect(rewriteStepToken(inheriting, { line: 0, raw: inheriting }, "pr")).toEqual({ ok: true, content: "- [ ] #wait pr Retour JMJ" });
	});

	it("is not rewritten as a Tag task", () => {
		expect(rewriteTaskTag(raw, ref, "#done 2026-10-20")).toEqual({ ok: false, reason: "changed" });
	});
});

describe("a Project step with its type tag further on the line", () => {
	it("sets, adds or removes its token, the tag moved in front", () => {
		const afterToken = "- [ ] pr #bug Do this ^s1";
		expect(setTaskToken(afterToken, { line: 0, raw: afterToken }, "p0")).toEqual({ ok: true, content: "- [ ] #bug p0 Do this ^s1" });
		expect(rewriteStepToken(afterToken, { line: 0, raw: afterToken }, null)).toEqual({ ok: true, content: "- [ ] #bug Do this ^s1" });
		const atEnd = "- [ ] Do this #wait";
		expect(rewriteStepToken(atEnd, { line: 0, raw: atEnd }, "p2")).toEqual({ ok: true, content: "- [ ] #wait p2 Do this" });
	});

	it("ticks and unticks it, its token and date found around the tag", () => {
		const open = "- [ ] p2 #bug Export ^ab12c";
		expect(setStepDone(open, { line: 0, raw: open }, "2026-10-24")).toEqual({ ok: true, content: "- [x] #bug 2026-10-24 Export ^ab12c" });
		const done = "- [x] p2 #bug 2026-10-24 Export";
		expect(setStepDone(done, { line: 0, raw: done }, null)).toEqual({ ok: true, content: "- [ ] #bug Export" });
	});

	it("leaves a step with its tag alone in front unchanged but for the token", () => {
		const raw = "- [ ] #quick";
		expect(rewriteStepToken(raw, { line: 0, raw }, null)).toEqual({ ok: true, content: "- [ ] #quick" });
	});
});

describe("setStepDone", () => {
	it("ticks a step: token dropped, date after the type tag", () => {
		const raw = "- [ ] #bug p2 Export Excel ^ab12c";
		expect(setStepDone(raw, { line: 0, raw, blockId: "ab12c" }, "2026-10-24")).toEqual({
			ok: true,
			content: "- [x] #bug 2026-10-24 Export Excel ^ab12c",
		});
	});

	it("ticks a step without type tag: date right after the checkbox", () => {
		const raw = "- [ ] pr Relire";
		expect(setStepDone(raw, { line: 0, raw }, "2026-10-24")).toEqual({ ok: true, content: "- [x] 2026-10-24 Relire" });
	});

	it("unticks a step: only the box and the date change", () => {
		const raw = "- [x] #bug 2026-10-24 Export Excel ^ab12c";
		expect(setStepDone(raw, { line: 0, raw }, null)).toEqual({ ok: true, content: "- [ ] #bug Export Excel ^ab12c" });
		const untyped = "- [X] 2026-10-24 Relire";
		expect(setStepDone(untyped, { line: 0, raw: untyped }, null)).toEqual({ ok: true, content: "- [ ] Relire" });
	});

	it("replaces the date of a step ticked again", () => {
		const raw = "- [x] #quick 2026-10-01 Relire";
		expect(setStepDone(raw, { line: 0, raw }, "2026-10-24")).toEqual({ ok: true, content: "- [x] #quick 2026-10-24 Relire" });
	});
});

describe("appendBlockId", () => {
	it("ends the pushed line with its ^id, even if lines moved above it since", () => {
		const raw = "#task p2 Widget saison";
		const content = ["ajout", "#task p1 Autre", raw, "  corps"].join("\n");
		expect(appendBlockId(content, { line: 1, raw }, "t7f3a")).toEqual({
			ok: true,
			content: ["ajout", "#task p1 Autre", "#task p2 Widget saison ^t7f3a", "  corps"].join("\n"),
		});
	});

	it("refuses when the line changed or appears twice", () => {
		const raw = "- [ ] Étape";
		expect(appendBlockId("- [ ] Étape modifiée", { line: 0, raw }, "s1")).toEqual({ ok: false, reason: "not-found" });
		expect(appendBlockId(`${raw}\n${raw}`, { line: 5, raw }, "s1")).toEqual({ ok: false, reason: "ambiguous" });
	});

	it("refuses a line that already has a block ID", () => {
		const raw = "#task p2 Titre ^abc";
		expect(appendBlockId(raw, { line: 0, raw }, "s1")).toEqual({ ok: false, reason: "changed" });
	});
});

describe("setTaskPriority with PZ and Rapide", () => {
	const at = (raw: string) => ({ line: 0, raw });

	it("writes pz on a Tag task, a step and over an older pz", () => {
		expect(setTaskPriority("#bug p2 Plantage ^t1", at("#bug p2 Plantage ^t1"), "pz")).toEqual({ ok: true, content: "#bug pz Plantage ^t1" });
		expect(setTaskPriority("- [ ] #bug Axe", at("- [ ] #bug Axe"), "pz")).toEqual({ ok: true, content: "- [ ] #bug pz Axe" });
		expect(setTaskPriority("#task pz Titre", at("#task pz Titre"), 2)).toEqual({ ok: true, content: "#task p2 Titre" });
	});

	it("removes the token of a #quick Tag task for Rapide, and leaves one without token as it is", () => {
		expect(setTaskPriority("#quick pz Renommer ^t2", at("#quick pz Renommer ^t2"), "pq")).toEqual({ ok: true, content: "#quick Renommer ^t2" });
		expect(setTaskPriority("#quick p3 Renommer", at("#quick p3 Renommer"), "pq")).toEqual({ ok: true, content: "#quick Renommer" });
		expect(setTaskPriority("#quick Renommer", at("#quick Renommer"), "pq")).toEqual({ ok: true, content: "#quick Renommer" });
	});

	it("refuses Rapide on any other line: no token there means P1, or inherit", () => {
		expect(setTaskPriority("#task p3 Titre", at("#task p3 Titre"), "pq")).toEqual({ ok: false, reason: "changed" });
		expect(setTaskPriority("#quickly p3 Titre", at("#quickly p3 Titre"), "pq")).toEqual({ ok: false, reason: "changed" });
		expect(setTaskPriority("- [ ] #quick p2 Étape", at("- [ ] #quick p2 Étape"), "pq")).toEqual({ ok: false, reason: "changed" });
	});

	it("still removes a step's token with null (inherit) and refuses null on a Tag task", () => {
		expect(setTaskPriority("- [ ] p2 Étape", at("- [ ] p2 Étape"), null)).toEqual({ ok: true, content: "- [ ] Étape" });
		expect(setTaskPriority("#quick pz Renommer", at("#quick pz Renommer"), null)).toEqual({ ok: false, reason: "changed" });
	});
});
