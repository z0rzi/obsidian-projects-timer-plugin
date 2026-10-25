import type { Priority } from "../remote/api";

/**
 * Where an item stands, as the Push modal and conflict buttons show it:
 * « Livré » (Project) or « Terminé » (Task) when Done, else its Priority:
 * P0–P5, « À valider » for PR, « Héritée » for none (a step inheriting).
 */
export function itemLabel(kind: "project" | "task", item: { priority: Priority | null; done: boolean }): string {
	if (item.done) return kind === "project" ? "Livré" : "Terminé";
	if (item.priority === null) return "Héritée";
	return item.priority === "pr" ? "À valider" : `P${item.priority}`;
}
