/** Obsidian's link resolver, as `app.metadataCache` offers it. */
export interface LinkResolver {
	getFirstLinkpathDest(linkpath: string, sourcePath: string): { path: string } | null;
}

/** How a link finds its Project: Obsidian's resolver, and which notes are Project notes. */
export interface ProjectRules {
	links: LinkResolver;
	isProject(path: string): boolean;
}

/** The Project note a link in `sourcePath` targets; null when it targets any other note, or none. */
export type ProjectOfLink = (linkpath: string) => string | null;

/** `ProjectOfLink` for the links of note `sourcePath`. */
export function projectOfLink(rules: ProjectRules, sourcePath: string): ProjectOfLink {
	return (linkpath) => {
		const target = rules.links.getFirstLinkpathDest(linkpath, sourcePath);
		return target && rules.isProject(target.path) ? target.path : null;
	};
}

/** The path of a wikilink's text, without its `|alias` and `#heading`. */
function linkpath(text: string): string {
	return text.split("|")[0]!.split("#")[0]!.trim();
}

/** Linkpaths of the wikilinks in `text`, embeds (`![[…]]`) left out. */
function wikilinks(text: string): string[] {
	return [...text.matchAll(/(?<!!)\[\[([^\]]+)\]\]/g)].map((m) => linkpath(m[1]!)).filter(Boolean);
}

const BARE_LINK = /^\[\[([^\]]+)\]\]$/;

/**
 * The Project a Tag task names itself: the first link on its line whose
 * target is a Project note, else its body's first line when that line is a
 * bare wikilink to a Project note (`bodyLink`: that line is not part of the
 * Description). Links deeper in the body are text. null = the note's Project
 * applies. Two different Project notes named: `error`.
 */
export function taskProject(
	raw: string,
	body: string[],
	projectOf: ProjectOfLink,
): { projectPath: string | null; bodyLink: boolean; error?: string } {
	const onLine = wikilinks(raw)
		.map(projectOf)
		.filter((p): p is string => p !== null);
	const bare = body[0]?.trim().match(BARE_LINK);
	const inBody = bare ? projectOf(linkpath(bare[1]!)) : null;
	const named = [...new Set([...onLine, ...(inBody ? [inBody] : [])])];
	const projectPath = named[0] ?? null;
	if (named.length > 1) {
		const titles = named.map((p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, ""));
		return { projectPath, bodyLink: inBody !== null, error: `lié à deux projets : ${titles.join(" et ")}` };
	}
	return { projectPath, bodyLink: inBody !== null };
}

/** The value of `key` in the note's frontmatter (the block between the first two `---` lines), unquoted. */
function frontmatterValue(content: string, key: string): string | null {
	const lines = content.split("\n");
	if (lines[0]?.trim() !== "---") return null;
	for (const line of lines.slice(1)) {
		if (line.trim() === "---") return null;
		const m = line.match(/^([^:]+):(.*)$/);
		if (m?.[1]!.trim() === key) return m[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
	}
	return null;
}

/**
 * The Project of the Tag tasks of note `path` that name none: its `project:`
 * frontmatter link when it targets a Project note, else the note itself when
 * it is a Project note or holds a `project` block; null = standalone.
 */
export function noteProject(rules: ProjectRules, path: string, content: string): string | null {
	const link = frontmatterValue(content, "project");
	const target = link ? projectOfLink(rules, path)(linkpath(link.replace(/^\[\[|\]\]$/g, ""))) : null;
	if (target) return target;
	if (rules.isProject(path) || content.split("\n").some((l) => l.startsWith("```project"))) return path;
	return null;
}
