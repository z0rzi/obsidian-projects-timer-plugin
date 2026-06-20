import { TFile } from "obsidian";

export const TASKS_TYPES = [
	{ tag: "ask", color: "#0cbc4b", faint: false },
	{ tag: "quick", color: "#f7d522", faint: false },
	{ tag: "bug", color: "#b82626", faint: false },
	{ tag: "task", color: "", faint: false },
	{ tag: "wait", color: "", faint: true },
] as const;

export type TaskTagLabel = typeof TASKS_TYPES[number]['tag']

export type Task = {
	id: number;
	title: string;
	description: string;
	projectFile?: TFile;
	file: TFile;
	line: number;
	priority: number;
	type: TaskTagLabel;
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
