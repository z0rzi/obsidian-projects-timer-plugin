/** `YYYY-MM-DD` of `date` in the machine's time zone (the day the Developer sees). */
export function localDay(date: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
