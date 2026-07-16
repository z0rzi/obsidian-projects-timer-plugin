import { TFile } from "obsidian";
import { ProjectCard, ProjectCardItem } from "./types";

export function findTasksHeadingSection(
	lines: string[],
): { start: number; end: number } | null {
	const headingPattern = /^(#{1,3})\s+(.+?)\s*$/;
	let matchedLevel = -1;
	let start = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const match = line.match(headingPattern);
		if (!match) continue;

		if (start === -1) {
			if (match[2]!.toLowerCase() === "tasks") {
				matchedLevel = match[1]!.length;
				start = i + 1;
			}
			continue;
		}

		if (match[1]!.length <= matchedLevel) {
			return { start, end: i };
		}
	}

	if (start === -1) return null;
	return { start, end: lines.length };
}

export function extractCheckboxItems(
	lines: string[],
	start: number,
	end: number,
): ProjectCardItem[] {
	const checkboxPattern = /^- \[( |x|X)\] (.+)$/;
	const items: ProjectCardItem[] = [];

	for (let i = start; i < end; i++) {
		const line = lines[i] ?? "";
		const match = line.match(checkboxPattern);
		if (!match) continue;

		items.push({
			text: match[2]!.trim(),
			line: i,
			checked: match[1]!.toLowerCase() === "x",
		});
	}

	return items;
}

export function selectPreviewItems(
	items: ProjectCardItem[],
): ProjectCardItem[] {
	const unchecked = items.filter((item) => !item.checked);
	const preview = unchecked.slice(0, 3);

	if (preview.length < 3) {
		const checked = items.filter((item) => item.checked);
		const fillCount = 3 - preview.length;
		preview.push(...checked.slice(-fillCount));
	}

	return preview;
}

export function parseProjectCard(params: {
	file: TFile;
	content: string;
	frontmatter: Record<string, unknown> | undefined;
	id: number;
}): ProjectCard | null {
	const { file, content, frontmatter, id } = params;

	if (frontmatter?.archived === true) return null;

	const priority = frontmatter?.priority;
	if (typeof priority !== "number") return null;

	const lines = content.split("\n");
	const section = findTasksHeadingSection(lines);
	const items = section
		? extractCheckboxItems(lines, section.start, section.end)
		: [];

	return { id, file, priority, items: selectPreviewItems(items) };
}
