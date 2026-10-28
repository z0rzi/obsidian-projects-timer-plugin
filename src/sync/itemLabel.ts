import type { Priority } from "../remote/api";

/** Labels of the Priorities that are not ranks. */
const WORD_LABELS = { pr: "À valider", pz: "Au frigo", pq: "Rapide" } as const;

/**
 * Where an item stands, as the Push modal and conflict buttons show it:
 * « Livré » (Project) or « Terminé » (Task) when Done, else its Priority:
 * P0–P5, « À valider » for PR, « Au frigo » for PZ, « Rapide », « Héritée »
 * for none (a step inheriting).
 */
export function itemLabel(kind: "project" | "task", item: { priority: Priority | null; done: boolean }): string {
	if (item.done) return kind === "project" ? "Livré" : "Terminé";
	if (item.priority === null) return "Héritée";
	return typeof item.priority === "number" ? `P${item.priority}` : WORD_LABELS[item.priority];
}
