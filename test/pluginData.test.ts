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

describe("PluginData", () => {
	it("holds the settings, URL and token only: an older sync state (bases, cursor, retries, conflicts) is dropped on load", async () => {
		const pushed = { t7f3a: { path: "2.projects/W.md", fields: { title: "W" } } };
		const conflicts = { "t7f3a:priority": { kind: "task", id: "t7f3a", field: "priority", remote: 1 } };
		const io = disk({
			projectsLocation: "2.projects",
			hourlyRate: 80,
			suiviUrl: "https://suivi",
			sync: { pushedProjects: pushed, pushedTasks: {}, cursor: 164, pullRetry: [{ id: 3 }], conflicts, appImages: {}, doneHistory: [] },
		});
		const data = await PluginData.load(defaults, io.load, io.save);

		expect(data.settings).toEqual({ projectsLocation: "2.projects", hourlyRate: 80, suiviUrl: "https://suivi" });
		data.settings.hourlyRate = 90;
		await data.save();
		expect(io.d.data).toEqual({ projectsLocation: "2.projects", hourlyRate: 90, suiviUrl: "https://suivi" });
	});

	it("starts from the defaults when there is no data.json yet", async () => {
		const io = disk(null);
		const data = await PluginData.load(defaults, io.load, io.save);
		expect(data.settings).toEqual(defaults);
	});

	it("runs sync jobs (Pull, Push, picks) one at a time, even when one fails", async () => {
		const { load, save } = disk({});
		const data = await PluginData.load(defaults, load, save);
		const order: string[] = [];
		let release!: () => void;
		const first = data.exclusive(async () => {
			order.push("pull start");
			await new Promise<void>((r) => (release = r));
			order.push("pull end");
			throw new Error("down");
		});
		const second = data.exclusive(async () => {
			order.push("push");
			return 2;
		});
		await Promise.resolve();
		release();
		await expect(first).rejects.toThrow("down");
		expect(await second).toBe(2);
		expect(order).toEqual(["pull start", "pull end", "push"]);
	});
});
