import { describe, expect, it } from "vitest";
import type { ProjectFields } from "../src/remote/api";
import type { SharedProject } from "../src/sync/sharedProject";
import { planProjectPush } from "../src/sync/pushPlan";
import { appWith } from "./fakeSuivi";

const fields: ProjectFields = { title: "Widget", description: "Desc", priority: 2, done: false, due_date: null };
const local = (over: Partial<SharedProject> & { fields?: Partial<ProjectFields> } = {}): SharedProject => ({
	path: `2.projects/${over.fields?.title ?? fields.title}.md`,
	...over,
	fields: { ...fields, ...over.fields },
});

describe("planProjectPush", () => {
	it("offers a Project never pushed as new", () => {
		expect(planProjectPush([local()], appWith())).toEqual([
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

	it("lists a suivi_id not in the app's format as an error, not pushed", () => {
		expect(planProjectPush([local({ suiviId: "legacy-42" })], appWith())).toEqual([
			{ group: "error", key: "error:2.projects/Widget.md", path: "2.projects/Widget.md", title: "Widget", error: "id non reconnu" },
		]);
	});

	it("does not offer archived Projects that were never pushed", () => {
		expect(planProjectPush([local({ fields: { priority: null, done: true } })], appWith())).toEqual([]);
	});

	it("offers nothing for a pushed Project that hasn't changed", () => {
		const pushed = { t7f3a: { path: "2.projects/Widget.md", fields } };

		expect(planProjectPush([local({ suiviId: "t7f3a" })], appWith(pushed))).toEqual([]);
	});

	it("lists each changed field old → new and sends only those", () => {
		const pushed = { t7f3a: { path: "2.projects/Widget.md", fields } };
		const now = local({
			suiviId: "t7f3a",
			path: "2.projects/Widget été.md",
			fields: { title: "Widget été", description: "Desc", priority: "pr" },
		});

		expect(planProjectPush([now], appWith(pushed))).toEqual([
			{
				group: "changed",
				key: "changed:t7f3a",
				id: "t7f3a",
				path: "2.projects/Widget été.md",
				title: "Widget été",
				fields: now.fields,
				diffs: [
					{ field: "title", from: "Widget", to: "Widget été" },
					{ field: "priority", from: 2, to: "pr" },
				],
				change: {
					op: "update",
					kind: "project",
					id: "t7f3a",
					fields: { title: "Widget été", priority: "pr" },
					expected: { title: "Widget", priority: 2 },
				},
			},
		]);
	});

	it("never offers an app Project no note carries (Unplaced)", () => {
		const pushed = { t7f3a: { path: "2.projects/Widget.md", fields } };

		expect(planProjectPush([], appWith(pushed))).toEqual([]);
	});

	it("creates a Project with an id the app doesn't know, keeping it", () => {
		expect(planProjectPush([local({ suiviId: "abcde" })], appWith())).toEqual([
			{
				group: "new",
				key: "new:2.projects/Widget.md",
				id: "abcde",
				path: "2.projects/Widget.md",
				title: "Widget",
				fields,
				change: { op: "create", kind: "project", id: "abcde", fields },
			},
		]);
	});

	it("sends what changed since the base, expecting the app's current values", () => {
		const app = appWith({ t7f3a: { path: "2.projects/Widget.md", fields } });
		app.projects.t7f3a!.current = { ...fields, priority: 4 };

		expect(planProjectPush([local({ suiviId: "t7f3a", fields: { title: "Widget 2" } })], app)).toMatchObject([
			{ group: "changed", change: { fields: { title: "Widget 2" }, expected: { title: "Widget" } } },
		]);
	});

	it("sends Done without comparing the Priority it no longer has", () => {
		const app = appWith({ t7f3a: { path: "2.projects/Widget.md", fields } });

		expect(planProjectPush([local({ suiviId: "t7f3a", fields: { priority: null, done: true } })], app)).toMatchObject([
			{ diffs: [{ field: "done", from: false, to: true }], change: { fields: { done: true }, expected: { done: false } } },
		]);
	});

	it("reopens a Done Project with its Priority, even one equal to the base", () => {
		const app = appWith({ t7f3a: { path: "2.projects/Widget.md", fields: { ...fields, done: true } } });
		app.projects.t7f3a!.current = { ...fields, priority: null, done: true };

		expect(planProjectPush([local({ suiviId: "t7f3a" })], app)).toMatchObject([
			{ change: { fields: { priority: 2, done: false }, expected: { priority: null, done: true } } },
		]);
	});
});
