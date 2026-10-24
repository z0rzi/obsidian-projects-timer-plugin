const FORMAT = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });

/** True for an Échéance month `YYYY-MM` (01 to 12). */
export function isDueMonth(value: string): boolean {
	return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The month `YYYY-MM` of an Échéance value: a day `YYYY-MM-DD` (written before the Échéance was a month) reads as its month. */
export function dueMonthOf(value: string): string {
	return value.slice(0, 7);
}

/** An Échéance (`YYYY-MM`, or an older `YYYY-MM-DD` read as its month) as the app words it, « janv. 2027 ». */
export function dueDateLabel(value: string): string {
	return FORMAT.format(new Date(`${dueMonthOf(value)}-01T00:00:00Z`));
}
