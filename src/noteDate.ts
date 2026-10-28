import { moment } from "obsidian";
import { localDay } from "./localDate";

/** A day at the start of a note's name, `2026-10-13` or `2026-10-13 Réunion JMJ`. */
const DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/;

/**
 * The day of a note, `YYYY-MM-DD`: the date its file name starts with (Daily
 * and meeting notes), read in the `moment` format `format` (the Daily Notes
 * one), else the local day the file was created.
 */
export function noteDate(file: { basename: string; stat: { ctime: number } }, format = "YYYY-MM-DD"): string {
	const named = format === "YYYY-MM-DD" ? isoPrefix(file.basename) : formatPrefix(file.basename, format);
	return named ?? localDay(new Date(file.stat.ctime));
}

function isoPrefix(name: string): string | null {
	const m = name.match(DAY_PREFIX);
	if (!m) return null;
	const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? m[0] : null;
}

/** The day `name` starts with in `format`: the name itself, or its part before a space (a meeting note's suffix). */
function formatPrefix(name: string, format: string): string | null {
	const cuts = [...name.matchAll(/ /g)].map((m) => m.index!);
	for (const end of [...cuts, name.length]) {
		const parsed = moment(name.slice(0, end), format, true);
		if (parsed.isValid()) return parsed.format("YYYY-MM-DD");
	}
	return null;
}
