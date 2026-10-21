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

	it("drops the pushedReviews of an older data.json on load", async () => {
		const review = { path: "2.projects/reviews/Démo.md", fields: { title: "Démo", body: "" }, answer: "valide" };
		const io = disk({ sync: { pushedProjects: pushed, pushedTasks: {}, pushedReviews: { r1abc: review } } });
		const data = await PluginData.load(defaults, io.load, io.save);

		await data.save();
		expect(io.d.data).toEqual({ ...defaults, sync: { pushedProjects: pushed, pushedTasks: {} } });
	});

	it("starts empty when there is no data.json yet", async () => {
		const io = disk(null);
		const data = await PluginData.load(defaults, io.load, io.save);

		expect(data.settings).toEqual(defaults);
		expect(data.sync).toEqual({ pushedProjects: {}, pushedTasks: {} });
	});

	it("runs sync jobs (Pull, Push) one at a time, even when one fails", async () => {
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
