import { describe, expect, it } from "vitest";
import { readReview } from "../src/sync/sharedReview";
import { planReviewPush, type PushedReviews } from "../src/sync/reviewPlan";
import type { ProjectLinks } from "../src/sync/taskPlan";

const projects: ProjectLinks = {
	"2.projects/Widget.md": { id: "p0002", title: "Widget" },
	"2.projects/Nouveau.md": { title: "Nouveau" },
	"2.projects/Secret.md": { hidden: true, title: "Secret" },
};
const note = (fm: string, body = "Voici le widget.") => `---\n${fm}\n---\n${body}\n`;
const path = "2.projects/reviews/Démo widget.md";

describe("readReview", () => {
	it("reads title, project link, task id, suivi_id and the whole body", () => {
		expect(readReview(path, note('project: "[[Widget]]"\ntask: ^t7f3a\nsuivi_id: r1abc', "# Démo\n\nTexte"))).toEqual({
			path,
			title: "Démo widget",
			projectLink: "Widget",
			taskId: "t7f3a",
			suiviId: "r1abc",
			body: "# Démo\n\nTexte",
		});
		expect(readReview(path, note("project: Widget"))).toMatchObject({ projectLink: "Widget", taskId: null });
		expect(readReview(path, note('project: "[[Widget]]"\ntask: "[[Widget#^t7f3a]]"'))).toMatchObject({ taskId: "t7f3a" });
	});
});

describe("planReviewPush", () => {
	const local = (fm: string, body?: string, projectPath: string | null = "2.projects/Widget.md") => ({
		...readReview(path, note(fm, body)),
		projectPath,
	});

	it("offers a new Review with its Project's id", () => {
		const { changes, problems } = planReviewPush([local("project: Widget\ntask: t7f3a")], projects, {});
		expect(problems).toEqual([]);
		expect(changes).toMatchObject([
			{
				group: "new",
				title: "Démo widget",
				change: {
					op: "create",
					kind: "review",
					fields: { title: "Démo widget", body: "Voici le widget.", project_id: "p0002", task_id: "t7f3a" },
				},
			},
		]);
	});

	it("waits for a Project pushed in the same Push, and skips a Review without a shared Project", () => {
		const { changes, problems } = planReviewPush(
			[
				local("project: Nouveau", undefined, "2.projects/Nouveau.md"),
				local("project: Secret", undefined, "2.projects/Secret.md"),
				local("", undefined, null),
			],
			projects,
			{},
		);
		expect(changes).toMatchObject([{ group: "new", needsProject: "2.projects/Nouveau.md" }]);
		expect(problems).toHaveLength(2);
	});

	it("offers changes against the last-pushed state, and archives a deleted Review", () => {
		const pushed: PushedReviews = {
			r1abc: {
				path,
				fields: { title: "Démo widget", body: "Ancien texte", project_id: "p0002", task_id: null },
			},
			r2old: { path: "2.projects/reviews/Vieille.md", fields: { title: "Vieille", body: "", project_id: "p0002", task_id: null } },
		};
		const { changes } = planReviewPush([local("project: Widget\nsuivi_id: r1abc")], projects, pushed);
		expect(changes).toMatchObject([
			{
				group: "changed",
				id: "r1abc",
				diffs: [{ field: "body" }],
				change: { op: "update", kind: "review", id: "r1abc", fields: { body: "Voici le widget." } },
			},
			{ group: "deleted", id: "r2old", change: { op: "archive", kind: "review", id: "r2old" } },
		]);
		expect(planReviewPush([local("project: Widget\nsuivi_id: r1abc", "Ancien texte")], projects, { r1abc: pushed.r1abc! }).changes).toEqual([]);
	});
});
