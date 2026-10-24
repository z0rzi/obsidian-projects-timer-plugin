import { describe, expect, it } from "vitest";
import { countAppIds, disconnect, disconnectMessage, removeAppIds } from "../src/sync/disconnect";
import { PluginData } from "../src/sync/pluginData";
import type { VaultFiles } from "../src/sync/runPull";

const project = "2.projects/Widget.md";
const meeting = "1.meetings/m.md";
const other = "notes/n.md";

/** Obsidian's `processFrontMatter` on the flat `key: value` frontmatter of these notes. */
function editFrontmatter(content: string, edit: (fm: Record<string, unknown>) => void): string {
	const lines = content.split("\n");
	const end = lines.indexOf("---", 1);
	const fm: Record<string, unknown> = {};
	for (const line of lines.slice(1, end)) {
		const [key, ...rest] = line.split(":");
		fm[key!.trim()] = rest.join(":").trim();
	}
	edit(fm);
	const yaml = Object.entries(fm).map(([k, v]) => `${k}: ${String(v)}`);
	return ["---", ...yaml, ...lines.slice(end)].join("\n");
}

function memoryVault(initial: Record<string, string>) {
	const files = new Map(Object.entries(initial));
	const vault: VaultFiles = {
		async read(path) {
			return files.get(path) ?? null;
		},
		async process(path, edit) {
			files.set(path, edit(files.get(path)!));
		},
		async processFrontMatter(path, edit) {
			files.set(path, editFrontmatter(files.get(path)!, edit));
		},
		paths: () => [...files.keys()],
	};
	return { files, vault };
}

const vaultWithIds = () =>
	memoryVault({
		[project]: "---\nsuivi_id: p0002\npriority: 2\n---\n# Tasks\n- [ ] Export ^s9xyz\n- [ ] Local step ^my-link\n",
		[meeting]: "#task Heatmap ^t7f3a\nnotes ^abcde\n#bug Crash ^b1234\n",
		[other]: "---\npriority: 1\n---\n#task Not pushed\n",
	});

describe("countAppIds", () => {
	it("counts Project notes with suivi_id and Task lines with an app-format block id", async () => {
		const { vault } = vaultWithIds();
		expect(await countAppIds(vault)).toEqual({ projects: 1, tasks: 3 });
	});
});

describe("removeAppIds", () => {
	it("removes suivi_id and app-format ^ids from Task lines, other block ids stay", async () => {
		const { vault, files } = vaultWithIds();
		await removeAppIds(vault);

		expect(files.get(project)).toBe("---\npriority: 2\n---\n# Tasks\n- [ ] Export\n- [ ] Local step ^my-link\n");
		expect(files.get(meeting)).toBe("#task Heatmap\nnotes ^abcde\n#bug Crash\n");
		expect(files.get(other)).toBe("---\npriority: 1\n---\n#task Not pushed\n");
		expect(await countAppIds(vault)).toEqual({ projects: 0, tasks: 0 });
	});
});

describe("disconnectMessage", () => {
	it("gives the real counts and the app URL", () => {
		expect(disconnectMessage({ projects: 21, tasks: 49 }, { suiviUrl: "https://edf-suivi.mbz-dev.com", suiviToken: "tok" })).toBe(
			"This removes the Client app IDs from 21 Project notes (`suivi_id`) and 49 Task lines (`^id`), and clears the Suivi URL and token. " +
				"Nothing is deleted from the Client app at https://edf-suivi.mbz-dev.com: the Client still sees everything. " +
				"If you reconnect this vault to that app later, every Item will be created again as a duplicate. " +
				"Links to these block IDs (`[[note#^id]]`) will break.",
		);
	});

	it("says no Client app is connected when the URL or token is empty", () => {
		expect(disconnectMessage({ projects: 1, tasks: 3 }, { suiviUrl: "https://edf-suivi.mbz-dev.com", suiviToken: "" })).toBe(
			"This removes the Client app IDs from 1 Project notes (`suivi_id`) and 3 Task lines (`^id`), and clears the Suivi URL and token. " +
				"No Client app is connected; only the IDs in the notes will be removed. " +
				"Links to these block IDs (`[[note#^id]]`) will break.",
		);
	});
});

describe("disconnect", () => {
	it("removes the ids and clears the Suivi URL, token and sync state in data.json", async () => {
		const { vault, files } = vaultWithIds();
		const disk: { data: unknown } = {
			data: {
				hourlyRate: 80,
				suiviUrl: "https://edf-suivi.mbz-dev.com",
				suiviToken: "tok",
				sync: { pushedProjects: { p0002: { path: project, fields: {} } }, pushedTasks: {}, cursor: 12 },
			},
		};
		const data = await PluginData.load(
			{ hourlyRate: 0, suiviUrl: "", suiviToken: "" },
			async () => disk.data,
			async (written) => {
				disk.data = JSON.parse(JSON.stringify(written));
			},
		);

		await disconnect(vault, data);

		expect(disk.data).toEqual({ hourlyRate: 80, suiviUrl: "", suiviToken: "", sync: {} });
		expect(files.get(meeting)).toBe("#task Heatmap\nnotes ^abcde\n#bug Crash\n");
	});
});
