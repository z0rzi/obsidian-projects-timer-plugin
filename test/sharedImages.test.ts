import { describe, expect, it } from "vitest";
import { uploadImage } from "../src/sync/sharedImages";
import type { SyncState } from "../src/sync/pluginData";

const bytes = (n: number) => new ArrayBuffer(n);

describe("uploadImage", () => {
	it("reuses the app URL of an image already in the app, unchanged in size", async () => {
		const sync: SyncState = { pushedProjects: {}, pushedTasks: {}, appImages: { "Attachments/u1.png": { url: "/uploads/u1.png", bytes: 42 } } };
		const sent: string[] = [];
		const url = await uploadImage(sync, { path: "Attachments/u1.png", name: "u1.png", data: bytes(42) }, async (_d, name) => {
			sent.push(name);
			return "/uploads/new.png";
		});
		expect(url).toBe("/uploads/u1.png");
		expect(sent).toEqual([]);
	});

	it("uploads a new or changed image and remembers its URL", async () => {
		const sync: SyncState = { pushedProjects: {}, pushedTasks: {}, appImages: { "Attachments/u1.png": { url: "/uploads/u1.png", bytes: 42 } } };
		const url = await uploadImage(sync, { path: "Attachments/u1.png", name: "u1.png", data: bytes(50) }, async () => "/uploads/v2.png");
		expect(url).toBe("/uploads/v2.png");
		expect(sync.appImages).toEqual({ "Attachments/u1.png": { url: "/uploads/v2.png", bytes: 50 } });

		const fresh: SyncState = { pushedProjects: {}, pushedTasks: {} };
		await uploadImage(fresh, { path: "img/a.png", name: "a.png", data: bytes(7) }, async () => "/uploads/a.png");
		expect(fresh.appImages).toEqual({ "img/a.png": { url: "/uploads/a.png", bytes: 7 } });
	});
});
