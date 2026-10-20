import { describe, expect, it } from "vitest";
import { PluginData } from "../src/sync/pluginData";

const defaults = { projectsLocation: "", hourlyRate: 0, suiviUrl: "" };

function disk(initial: unknown) {
	const d = { data: initial };
	return {
		d,
		load: async () => d.data,
		save: async (data: unknown) => {
			d.data = JSON.parse(JSON.stringify(data));
		},
	};
}

const pushed = { t7f3a: { path: "2.projects/W.md", fields: { title: "W", description: "", status: "a_faire" as const, priority: 1 } } };

describe("PluginData", () => {
	it("reads settings and sync state from the same data.json without mixing them", async () => {
		const io = disk({ projectsLocation: "2.projects", hourlyRate: 80, sync: { pushedProjects: pushed } });
		const data = await PluginData.load(defaults, io.load, io.save);

		expect(data.settings).toEqual({ projectsLocation: "2.projects", hourlyRate: 80, suiviUrl: "" });
		expect(data.sync.pushedProjects).toEqual(pushed);
	});

	it("saving settings keeps the sync state, and saving sync state keeps the settings", async () => {
		const io = disk({ projectsLocation: "2.projects", hourlyRate: 80, sync: { pushedProjects: pushed } });
		const data = await PluginData.load(defaults, io.load, io.save);

		data.settings.hourlyRate = 90;
		await data.save();
		expect(io.d.data).toEqual({ projectsLocation: "2.projects", hourlyRate: 90, suiviUrl: "", sync: { pushedProjects: pushed, pushedTasks: {} } });

		delete data.sync.pushedProjects.t7f3a;
		await data.save();
		expect(io.d.data).toEqual({ projectsLocation: "2.projects", hourlyRate: 90, suiviUrl: "", sync: { pushedProjects: {}, pushedTasks: {} } });
	});

	it("starts empty when there is no data.json yet", async () => {
		const io = disk(null);
		const data = await PluginData.load(defaults, io.load, io.save);

		expect(data.settings).toEqual(defaults);
		expect(data.sync).toEqual({ pushedProjects: {}, pushedTasks: {} });
	});
});
