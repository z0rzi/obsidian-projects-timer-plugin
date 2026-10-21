import { describe, expect, it } from "vitest";
import type { App, ViewState, WorkspaceLeaf } from "obsidian";
import { openView } from "../src/ui/openView";

const TYPE = "suivi-inbox-view";

/** The view class the plugin registered for TYPE. */
class LiveView {}

/** A leaf as Obsidian hands it out: `setViewState` installs a LiveView for TYPE, `loadIfDeferred` too. */
function fakeLeaf(view: unknown, deferred = false) {
	const states: ViewState[] = [];
	const leaf = {
		view,
		isDeferred: deferred,
		async loadIfDeferred() {
			this.isDeferred = false;
			this.view = new LiveView();
		},
		async setViewState(state: ViewState) {
			states.push(state);
			this.view = state.type === TYPE ? new LiveView() : {};
		},
	};
	return { leaf: leaf as unknown as WorkspaceLeaf, states };
}

function fakeApp(existing: WorkspaceLeaf | null, fresh: WorkspaceLeaf) {
	const revealed: WorkspaceLeaf[] = [];
	const app = {
		workspace: {
			getLeavesOfType: (type: string) => (existing && type === TYPE ? [existing] : []),
			getRightLeaf: () => fresh,
			revealLeaf: async (leaf: WorkspaceLeaf) => {
				revealed.push(leaf);
			},
		},
	} as unknown as App;
	return { app, revealed };
}

describe("openView", () => {
	it("opens a new right leaf when none shows the view", async () => {
		const fresh = fakeLeaf({});
		const { app, revealed } = fakeApp(null, fresh.leaf);
		const leaf = await openView(app, TYPE, "Suivi inbox", { active: true }, LiveView);
		expect(leaf).toBe(fresh.leaf);
		expect(fresh.states).toEqual([{ type: TYPE, active: true }]);
		expect(revealed).toEqual([fresh.leaf]);
	});

	it("only reveals a leaf whose view is live", async () => {
		const existing = fakeLeaf(new LiveView());
		const fresh = fakeLeaf({});
		const { app, revealed } = fakeApp(existing.leaf, fresh.leaf);
		expect(await openView(app, TYPE, "Suivi inbox", { active: true }, LiveView)).toBe(existing.leaf);
		expect(existing.states).toEqual([]);
		expect(fresh.states).toEqual([]);
		expect(revealed).toEqual([existing.leaf]);
	});

	it("loads a deferred leaf restored from workspace.json instead of rebuilding it", async () => {
		const existing = fakeLeaf({}, true);
		const { app, revealed } = fakeApp(existing.leaf, fakeLeaf({}).leaf);
		expect(await openView(app, TYPE, "Suivi inbox", { active: true }, LiveView)).toBe(existing.leaf);
		expect(existing.leaf.view).toBeInstanceOf(LiveView);
		expect(existing.states).toEqual([]);
		expect(revealed).toEqual([existing.leaf]);
	});

	it("rebuilds a stale leaf whose view is not the registered class", async () => {
		const existing = fakeLeaf({ stale: true });
		const { app, revealed } = fakeApp(existing.leaf, fakeLeaf({}).leaf);
		expect(await openView(app, TYPE, "Suivi inbox", { active: false }, LiveView)).toBe(existing.leaf);
		expect(existing.states).toEqual([{ type: "empty" }, { type: TYPE, active: false }]);
		expect(existing.leaf.view).toBeInstanceOf(LiveView);
		expect(revealed).toEqual([existing.leaf]);
	});

	it("gives up with a notice when no leaf can be made", async () => {
		const { app, revealed } = fakeApp(null, null as unknown as WorkspaceLeaf);
		expect(await openView(app, TYPE, "Suivi inbox", { active: true }, LiveView)).toBeNull();
		expect(revealed).toEqual([]);
	});
});
