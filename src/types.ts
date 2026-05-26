import { TFile } from "obsidian";

export type Task = {
	id: number;
	title: string;
	description: string;
	projectFile?: TFile;
	file: TFile;
	line: number;
	priority: number;
	type: "task" | "bug" | "now" | "wait";
};

export interface TimeSource {
	label: string;
	resolvedFile: TFile | null;
	duration: number; // in minutes
	/** Just for visual purposes, will add the text after the label */
	info_text: string;
}

export interface Activity {
	date: string;
	duration: number; // in minutes
	description: string;
}
