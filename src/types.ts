import { TFile } from "obsidian";

const borderLeft = 'border-left: 4px solid var(--card-color);'

export const TASKS_TYPES = [
	{ tag: "ask", color: "#0cbc4b", css: borderLeft },
	{ tag: "quick", color: "#f7d522", css: borderLeft },
	{ tag: "bug", color: "#b82626", css: borderLeft },
	{ tag: "project", color: "#2677b8", css: `border: 3px solid var(--card-color);` },
	{ tag: "task", color: "", css: '' },
	{ tag: "wait", color: "", css: 'opacity: 0.6;' },
] as const;

export type TaskTagLabel = typeof TASKS_TYPES[number]['tag']

export type Task = {
	id: string;
	title: string;
	description: string;
	projectFile?: TFile;
	file: TFile;
	line: number;
	priority: number;
	type: TaskTagLabel;
};

export type ProjectCardItem = {
	text: string;
	line: number;
	checked: boolean;
};

export type ProjectCard = {
	id: string;
	file: TFile;
	priority: number;
	items: ProjectCardItem[];
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
