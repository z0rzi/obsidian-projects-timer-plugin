const FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** An Échéance (`YYYY-MM-DD`) as the app words it, « 1 mars 2027 ». */
export function dueDateLabel(iso: string): string {
	return FORMAT.format(new Date(`${iso}T00:00:00Z`));
}
