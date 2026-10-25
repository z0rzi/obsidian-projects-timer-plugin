import { describe, expect, it } from "vitest";
import { readProjectSteps, readTagTasks } from "../src/sync/sharedTask";

const meeting = [
	"---",
	'project: "[[2.projects/Chainage Tetris]]"',
	"---",
	"#task p2 Nouveau widget saison ^t7f3a",
	"  corps de la tâche",
	"",
	"    - détail",
	"pas le corps",
	"",
	"#bug Légende manquante",
	"#wait pr Accès serveur EDF",
	"#quick p0 Relancer Marc",
	"#task p1 Salaire de JMJ #private",
	"#done 2026-10-12 Bloquer les mdp ^t91c2",
	"#done [excel] faire un tableau",
	"#ask p1 Ancien tag",
].join("\n");

describe("readTagTasks", () => {
	it("shares the line of each Tag task with its token read as Priority or Done, and its de-indented body", () => {
		const tasks = readTagTasks("1.meetings/2026-10-13.md", meeting, "2.projects/Chainage Tetris.md");
		expect(tasks.map(({ path, projectPath, line, ...t }) => t)).toEqual([
			{ raw: "#task p2 Nouveau widget saison ^t7f3a", blockId: "t7f3a", title: "Nouveau widget saison", type: "task", step: false, priority: 2, done: false, description: "corps de la tâche\n\n  - détail" },
			{ raw: "#bug Légende manquante", title: "Légende manquante", type: "bug", step: false, priority: 1, done: false, description: "" },
			{ raw: "#wait pr Accès serveur EDF", title: "Accès serveur EDF", type: "wait", step: false, priority: "pr", done: false, description: "" },
			{ raw: "#quick p0 Relancer Marc", title: "Relancer Marc", type: "quick", step: false, priority: 0, done: false, description: "" },
			{ raw: "#done 2026-10-12 Bloquer les mdp ^t91c2", blockId: "t91c2", title: "Bloquer les mdp", type: null, step: false, priority: null, done: true, doneOn: "2026-10-12", description: "" },
			{ raw: "#done [excel] faire un tableau", title: "[excel] faire un tableau", type: null, step: false, priority: null, done: true, description: "" },
		]);
		expect(tasks.every((t) => t.projectPath === "2.projects/Chainage Tetris.md")).toBe(true);
		expect(tasks.map((t) => t.line)).toEqual([3, 9, 10, 11, 13, 14]);
		expect(JSON.stringify(tasks)).not.toContain("pas le corps");
	});

	it("removes the first body line's indentation from every line, tabs or spaces, keeping the relative indent", () => {
		const tabs = readTagTasks("a.md", "#task p1 T\n\tligne\n\t\t- sous\n\n\tfin\n", null);
		expect(tabs[0]!.description).toBe("ligne\n\t- sous\n\nfin");
		const spaces = readTagTasks("a.md", "#done 2026-10-01 D\n    ligne\n  moins", null);
		expect(spaces[0]!.description).toBe("ligne\nmoins");
	});

	it("keeps the relative indent when tabs and spaces mix, a tab counting 4 columns", () => {
		const tabFirst = readTagTasks("a.md", "#task p1 T\n\tligne\n      - sous\n  moins", null);
		expect(tabFirst[0]!.description).toBe("ligne\n  - sous\nmoins");
		const spacesFirst = readTagTasks("a.md", "#task p1 T\n    ligne\n\t\t- sous\n  \t- mi", null);
		expect(spacesFirst[0]!.description).toBe("ligne\n\t- sous\n- mi");
	});

	it("leaves out #private lines with their body, and nothing else", () => {
		const tasks = readTagTasks("a.md", "#task p1 Salaire #private\n  montant secret\n#done 2026-10-01 #private Prime\n#task p1 Visible\n  #private dans le corps", null);
		expect(tasks.map((t) => [t.title, t.description])).toEqual([["Visible", "#private dans le corps"]]);
	});
});

const projectNote = [
	"---",
	"priority: 3",
	"---",
	"# Description",
	"Un projet.",
	"# Tasks",
	"---",
	"- [ ] fix the x axis ^t04be",
	"  - [ ] sous-étape",
	"    détails",
	"- [ ] #bug p1 Override urgent",
	"- [ ] pr Export CSV",
	"- [ ] p0 En train",
	"- [x] #quick Livré",
	"- [ ] Secret #private",
	"# Time usage",
	"- [ ] pas une étape",
].join("\n");

describe("readProjectSteps", () => {
	it("shares the top-level steps under Tasks with their type tag (task without), inheriting Priority unless they carry a token", () => {
		const steps = readProjectSteps("2.projects/Widget.md", projectNote);
		expect(steps.map(({ path, raw, line, ...s }) => s)).toEqual([
			{ blockId: "t04be", title: "fix the x axis", type: "task", step: true, priority: null, done: false, projectPath: "2.projects/Widget.md", description: "- [ ] sous-étape\n  détails" },
			{ title: "Override urgent", type: "bug", step: true, priority: 1, done: false, projectPath: "2.projects/Widget.md", description: "" },
			{ title: "Export CSV", type: "task", step: true, priority: "pr", done: false, projectPath: "2.projects/Widget.md", description: "" },
			{ title: "En train", type: "task", step: true, priority: 0, done: false, projectPath: "2.projects/Widget.md", description: "" },
			{ title: "Livré", type: "quick", step: true, priority: null, done: true, projectPath: "2.projects/Widget.md", description: "" },
		]);
		expect(JSON.stringify(steps)).not.toMatch(/Secret|pas une étape/);
	});

	it("shares the same step whether its type tag is in front or further on the line", () => {
		const front = readProjectSteps("2.projects/W.md", "# Tasks\n- [ ] #bug pr Do this ^s1");
		const moved = readProjectSteps("2.projects/W.md", "# Tasks\n- [ ] pr Do this #bug ^s1");
		expect(moved.map(({ raw, ...s }) => s)).toEqual(front.map(({ raw, ...s }) => s));
		expect(moved[0]).toMatchObject({ title: "Do this", type: "bug", priority: "pr" });
	});

	it("reads the date after a done step's type tag (or checkbox) as its done date", () => {
		const note = "# Tasks\n- [x] #bug 2026-10-24 Export Excel ^ab12c\n- [x] 2026-10-20 Relire\n- [x] Ancien";
		expect(readProjectSteps("2.projects/W.md", note).map((s) => [s.title, s.doneOn])).toEqual([
			["Export Excel", "2026-10-24"],
			["Relire", "2026-10-20"],
			["Ancien", undefined],
		]);
	});
});
