import { describe, expect, it } from "vitest";
import { AppImages } from "../src/comments/appImages";
import { uploadedImages, withAppUrls } from "../src/comments/commentMarkdown";

describe("comment markdown for Obsidian", () => {
	it("points app links at the app, and uploaded images at the fetched copies", () => {
		const images = new Map([["/uploads/abc.png", "blob:app/1"]]);
		expect(withAppUrls("Voir ![](/uploads/abc.png) et [la tâche](/taches/t7f3a)", "https://suivi.test/", images)).toBe(
			"Voir ![](blob:app/1) et [la tâche](https://suivi.test/taches/t7f3a)",
		);
	});

	it("never points an image at the app's /uploads (it needs a session): shows its alt text instead", () => {
		expect(withAppUrls("a ![capture](/uploads/x.png) b ![](/uploads/y.png)", "https://suivi.test")).toBe(
			"a *(image: capture)* b *(image)*",
		);
	});

	it("leaves absolute links, anchors and plain text alone", () => {
		const body = "[ext](https://ex.com/a) [ancre](#x) [proto](//ex.com) /uploads/pas-un-lien.png";
		expect(withAppUrls(body, "https://suivi.test")).toBe(body);
	});

	it("lists the uploaded images a body shows, once each", () => {
		expect(uploadedImages("![](/uploads/a.png) ![x](/uploads/b.jpg) ![](/uploads/a.png) [lien](/uploads/c.png) ![](https://e.x/d.png)")).toEqual([
			"/uploads/a.png",
			"/uploads/b.jpg",
		]);
	});
});

describe("AppImages (uploaded images fetched with the token)", () => {
	function images(fail = new Set<string>()) {
		const fetched: string[] = [];
		const revoked: string[] = [];
		let n = 0;
		const cache = new AppImages(
			async (path) => {
				fetched.push(path);
				if (fail.has(path)) throw new Error("404");
				return { data: new ArrayBuffer(1), type: "image/png" };
			},
			() => `blob:app/${++n}`,
			(url) => revoked.push(url),
		);
		return { cache, fetched, revoked };
	}

	it("fetches each image once and hands out local URLs", async () => {
		const { cache, fetched } = images();
		const first = await cache.urls(["/uploads/a.png", "/uploads/b.png"]);
		const again = await cache.urls(["/uploads/a.png"]);
		expect([...first]).toEqual([
			["/uploads/a.png", "blob:app/1"],
			["/uploads/b.png", "blob:app/2"],
		]);
		expect(again.get("/uploads/a.png")).toBe("blob:app/1");
		expect(fetched).toEqual(["/uploads/a.png", "/uploads/b.png"]);
	});

	it("leaves out an image it can't fetch, and tries again next time", async () => {
		const { cache, fetched } = images(new Set(["/uploads/gone.png"]));
		expect((await cache.urls(["/uploads/gone.png"])).size).toBe(0);
		await cache.urls(["/uploads/gone.png"]);
		expect(fetched).toEqual(["/uploads/gone.png", "/uploads/gone.png"]);
	});

	it("revokes its URLs when cleared", async () => {
		const { cache, revoked } = images();
		await cache.urls(["/uploads/a.png"]);
		cache.clear();
		expect(revoked).toEqual(["blob:app/1"]);
	});
});
