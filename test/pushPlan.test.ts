import { describe, expect, it } from "vitest";
import type { ProjectFields } from "../src/remote/api";
import type { SharedProject } from "../src/sync/sharedProject";
import { planProjectPush } from "../src/sync/pushPlan";

const fields: ProjectFields = { title: "Widget", description: "Desc", status: "a_faire", priority: 2 };
const local = (over: Partial<SharedProject> & { fields?: Partial<ProjectFields> } = {}): SharedProject => ({
	path: `2.projects/${over.fields?.title ?? fields.title}.md`,
	archived: false,
	...over,
	fields: { ...fields, ...over.fields },
});

describe("planProjectPush", () => {
	it("offers a Project never pushed as new", () => {
		expect(planProjectPush([local()], {})).toEqual([
			{
				group: "new",
				key: "new:2.projects/Widget.md",
				path: "2.projects/Widget.md",
				title: "Widget",
				fields,
				change: { op: "create", kind: "project", fields },
			},
		]);
	});

	it("does not offer archived Projects that were never pushed", () => {
		expect(planProjectPush([local({ archived: true, fields: { status: "termine" } })], {})).toEqual([]);
	});

	it("offers nothing for a pushed Project that hasn't changed", () => {
		const pushed = { t7f3a: { path: "2.projects/Widget.md", fields } };

		expect(planProjectPush([local({ suiviId: "t7f3a" })], pushed)).toEqual([]);
	});

	it("lists each changed field old → new and sends only those", () => {
		const pushed = { t7f3a: { path: "2.projects/Widget.md", fields } };
		const now = local({
			suiviId: "t7f3a",
			path: "2.projects/Widget été.md",
			fields: { title: "Widget été", description: "Desc", status: "en_cours", priority: 1 },
		});

		expect(planProjectPush([now], pushed)).toEqual([
			{
				group: "changed",
				key: "changed:t7f3a",
				id: "t7f3a",
				path: "2.projects/Widget été.md",
				title: "Widget été",
				fields: now.fields,
				diffs: [
					{ field: "title", from: "Widget", to: "Widget été" },
					{ field: "status", from: "a_faire", to: "en_cours" },
					{ field: "priority", from: 2, to: 1 },
				],
				change: {
					op: "update",
					kind: "project",
					id: "t7f3a",
					fields: { title: "Widget été", status: "en_cours", priority: 1 },
				},
			},
		]);
	});

	it("offers a pushed Project whose file is gone, or now prive, as deleted (archive)", () => {
		const pushed = { t7f3a: { path: "2.projects/Widget.md", fields } };

		expect(planProjectPush([], pushed)).toEqual([
			{
				group: "deleted",
				key: "deleted:t7f3a",
				id: "t7f3a",
				title: "Widget",
				change: { op: "archive", kind: "project", id: "t7f3a" },
			},
		]);
	});

	it("sends every field of a Project with an id this machine never pushed", () => {
		const [change] = planProjectPush([local({ suiviId: "abcde" })], {});

		expect(change).toMatchObject({
			group: "changed",
			diffs: [
				{ field: "title", from: null, to: "Widget" },
				{ field: "description", from: null, to: "Desc" },
				{ field: "status", from: null, to: "a_faire" },
				{ field: "priority", from: null, to: 2 },
			],
			change: { op: "update", id: "abcde", fields },
		});
	});
});
