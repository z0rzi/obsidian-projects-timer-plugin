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
	it("shares the line of each Tag task with its status token mapped, and its de-indented body", () => {
		const tasks = readTagTasks("1.meetings/2026-10-13.md", meeting, "2.projects/Chainage Tetris.md");
		expect(tasks.map(({ path, projectPath, line, ...t }) => t)).toEqual([
			{ raw: "#task p2 Nouveau widget saison ^t7f3a", blockId: "t7f3a", title: "Nouveau widget saison", type: "task", status: "a_faire", priority: 2, description: "corps de la tâche\n\n  - détail" },
			{ raw: "#bug Légende manquante", title: "Légende manquante", type: "bug", status: "a_faire", priority: 1, description: "" },
			{ raw: "#wait pr Accès serveur EDF", title: "Accès serveur EDF", type: "wait", status: "a_valider", priority: null, description: "" },
			{ raw: "#quick p0 Relancer Marc", title: "Relancer Marc", type: "quick", status: "en_cours", priority: 0, description: "" },
			{ raw: "#done 2026-10-12 Bloquer les mdp ^t91c2", blockId: "t91c2", title: "Bloquer les mdp", type: null, status: "termine", priority: null, doneOn: "2026-10-12", description: "" },
			{ raw: "#done [excel] faire un tableau", title: "[excel] faire un tableau", type: null, status: "termine", priority: null, description: "" },
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
	"- [ ] p1 Override urgent",
	"- [ ] pr Export CSV",
	"- [ ] p0 En train",
	"- [x] Livré",
	"- [ ] Secret #private",
	"# Time usage",
	"- [ ] pas une étape",
].join("\n");

describe("readProjectSteps", () => {
	it("shares the top-level steps under Tasks, inheriting Priority unless they carry a token", () => {
		const steps = readProjectSteps("2.projects/Widget.md", projectNote);
		expect(steps.map(({ path, raw, line, ...s }) => s)).toEqual([
			{ blockId: "t04be", title: "fix the x axis", type: "step", status: "a_faire", priority: null, projectPath: "2.projects/Widget.md", description: "- [ ] sous-étape\n  détails" },
			{ title: "Override urgent", type: "step", status: "a_faire", priority: 1, projectPath: "2.projects/Widget.md", description: "" },
			{ title: "Export CSV", type: "step", status: "a_valider", priority: null, projectPath: "2.projects/Widget.md", description: "" },
			{ title: "En train", type: "step", status: "en_cours", priority: 0, projectPath: "2.projects/Widget.md", description: "" },
			{ title: "Livré", type: "step", status: "termine", priority: null, projectPath: "2.projects/Widget.md", description: "" },
		]);
		expect(JSON.stringify(steps)).not.toMatch(/Secret|pas une étape/);
	});
});
