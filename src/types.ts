import { TFile } from "obsidian";
import type { Priority } from "./remote/api";

const borderLeft = 'border-left: 4px solid var(--card-color);'

export const TASKS_TYPES = [
	{ tag: "quick", color: "#f7d522", css: borderLeft },
	{ tag: "bug", color: "#b82626", css: borderLeft },
	{ tag: "task", color: "", css: "" },
	{ tag: "wait", color: "var(--text-faint)", css: 'opacity: 0.6; border: 2px dashed var(--card-color); font-style: italic;' },
] as const;

export type TaskTagLabel = typeof TASKS_TYPES[number]['tag']

export type Task = {
	id: string;
	title: string;
	description: string;
	projectFile?: TFile;
	file: TFile;
	line: number;
	/** From its token (`p0`–`p5`, `pr` for PR); 1 without one. */
	priority: Priority;
	type: TaskTagLabel;
	blockId?: string;
	/** Line content when parsed, to check it is unchanged before writing. */
	raw: string;
};

export type ProjectCardItem = {
	text: string;
	line: number;
	checked: boolean;
	/** Type tag anywhere on the line, written after the checkbox (`- [ ] #bug p2 …`); "task" without one. */
	type: TaskTagLabel;
	blockId?: string;
	/** Done date of a ticked step, first word once its type tag is out (`- [x] #bug 2026-10-24 …`). */
	doneOn?: string;
	/** Priority token carried by the step itself, replacing the Project's priority. */
	override?: Priority;
	/** Line content when parsed, to check it is unchanged before writing. */
	raw: string;
	/** Indented lines under the step, as written (same rule as a Tag task's description). */
	body: string;
};

export type ProjectCard = {
	id: string;
	file: TFile;
	/** `priority:` frontmatter, `pr` putting the card in the to validate column. */
	priority: Priority;
	/** Preview shown on the Project card. */
	items: ProjectCardItem[];
	/** Open steps carrying their own token, shown as their own cards. */
	overrides: ProjectCardItem[];
};

export interface TimeSource {
	label: string;
	resolvedFile: TFile | null;
	duration: number; // in minutes
	sourceFile: TFile;
	status: "pending" | "accepted" | "refused" | "paid" | "";
	completed: boolean;
}

export interface Activity {
	date: string;
	duration: number; // in minutes
	description: string;
}
