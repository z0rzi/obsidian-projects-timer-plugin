import { TFile } from "obsidian";
import { ProjectCard, ProjectCardItem } from "./types";
import { splitBlockId } from "./blockId";
import { DAY_SOURCE, readIndentedBody, readStatusToken, readTypeTag } from "./taskParser";

/** Done date of a ticked step, first word after its type tag. */
const DONE_DAY = new RegExp(`^(${DAY_SOURCE})(?: |$)`);

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

		const checked = match[1]!.toLowerCase() === "x";
		const tagged = readTypeTag(match[2]!.trim());
		const { token, rest } = readStatusToken(tagged.rest);
		const doneOn = checked ? rest.match(DONE_DAY)?.[1] : undefined;
		const { text, blockId } = splitBlockId(doneOn ? rest.slice(doneOn.length).trimStart() : rest);
		items.push({
			text,
			line: i,
			checked,
			type: tagged.type,
			...(blockId ? { blockId } : {}),
			...(doneOn ? { doneOn } : {}),
			...(token ? { override: token } : {}),
			raw: line,
			body: readIndentedBody(lines, i, end).join("\n"),
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

export function parseFrontmatter(content: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = content.split("\n");
	if (lines[0]?.trim() !== "---") return result;

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (line?.trim() === "---") break;
		const match = line?.match(/^(\w+)\s*:\s*(.+)$/);
		if (match) {
			const key = match[1]!;
			let value: unknown = match[2]!.trim();
			if (value === "true") value = true;
			else if (value === "false") value = false;
			else if (/^-?\d+(\.\d+)?$/.test(value as string)) value = Number(value);
			result[key] = value;
		}
	}
	return result;
}

export function parseProjectCard(params: {
	file: TFile;
	content: string;
}): ProjectCard | null {
	const { file, content } = params;
	const frontmatter = parseFrontmatter(content);

	if (frontmatter.archived === true) return null;

	const priority = frontmatter.priority;
	if (typeof priority !== "number") return null;

	const lines = content.split("\n");
	const section = findTasksHeadingSection(lines);
	const items = section
		? extractCheckboxItems(lines, section.start, section.end)
		: [];

	return {
		id: file.path,
		file,
		priority,
		items: selectPreviewItems(items),
		overrides: items.filter((item) => item.override && !item.checked),
	};
}

/** Sets `priority:` in the frontmatter, adding the key (or the frontmatter) when missing. */
export function setFrontmatterPriority(
	content: string,
	newPriority: number,
): string {
	const lines = content.split("\n");
	if (lines[0]?.trim() !== "---") return `---\npriority: ${newPriority}\n---\n${content}`;
	const closingIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
	if (closingIdx < 0) return content;

	for (let i = 1; i < closingIdx; i++) {
		if (lines[i]?.match(/^priority\s*:/)) {
			lines[i] = `priority: ${newPriority}`;
			return lines.join("\n");
		}
	}
	lines.splice(closingIdx, 0, `priority: ${newPriority}`);
	return lines.join("\n");
}
