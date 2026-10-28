import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { dailyNotePath, dailyNotesOptions } from "../src/dailyNote";

const appWith = (options: unknown) =>
	({ internalPlugins: { getPluginById: (id: string) => (id === "daily-notes" ? { instance: { options } } : null) } }) as unknown as App;

describe("Daily notes settings", () => {
	it("reads the core plugin's folder and format", () => {
		expect(dailyNotesOptions(appWith({ folder: "1.meetings/", format: "YYYY-MM-DD", template: "8.templates/Meeting.md" }))).toEqual({
			folder: "1.meetings",
			format: "YYYY-MM-DD",
		});
	});

	it("falls back to the core defaults: the vault's root, YYYY-MM-DD", () => {
		expect(dailyNotesOptions(appWith({}))).toEqual({ folder: "", format: "YYYY-MM-DD" });
		expect(dailyNotesOptions({} as App)).toEqual({ folder: "", format: "YYYY-MM-DD" });
	});

	it("names today's note by the format in the folder", () => {
		const day = new Date(2026, 9, 27, 23, 30);
		expect(dailyNotePath({ folder: "1.meetings", format: "YYYY-MM-DD" }, day)).toBe("1.meetings/2026-10-27.md");
		expect(dailyNotePath({ folder: "", format: "YYYY-MM-DD" }, day)).toBe("2026-10-27.md");
	});
});
