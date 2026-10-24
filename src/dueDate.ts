const FORMAT = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });

/** True for an Échéance month `YYYY-MM` (01 to 12). */
export function isDueMonth(value: string): boolean {
	return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** An Échéance (`YYYY-MM`, or an older `YYYY-MM-DD` read as its month) as the app words it, « janv. 2027 ». */
export function dueDateLabel(iso: string): string {
	return FORMAT.format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`));
}
