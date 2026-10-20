import { parseLinktext, type App, type TFile } from "obsidian";

/** Project of a Tag task in `file`: the `project:` frontmatter link, else the file itself if it has a `project` block. */
export function tagTaskProject(app: App, file: TFile, content: string): string | null {
	const link = app.metadataCache.getFileCache(file)?.frontmatter?.project;
	if (typeof link === "string" && link.trim()) {
		const linkpath = parseLinktext(link.replace(/^\[\[|\]\]$/g, "").split("|")[0]!.trim()).path;
		const target = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
		if (target) return target.path;
	}
	return content.split("\n").some((l) => l.startsWith("```project")) ? file.path : null;
}
