import type { ProjectFields, TaskStateFields } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { AppItems } from "./appState";
import type { PushVault } from "./planPush";

/** An app Item, Triaged or pushed and not archived, that no readable note carries (spec section 7), with its app fields now. */
export type UnplacedItem =
	| { kind: "project"; id: string; fields: ProjectFields }
	| { kind: "task"; id: string; fields: TaskStateFields; projectTitle: string | null };

/**
 * The app's Unplaced items: non-archived, Triaged or pushed Items whose id no
 * Project note or Task line of `vault` carries. Items of an unreadable Project
 * note (the Project, and the steps based in it or listed under it) are left out.
 */
export function unplacedItems(vault: PushVault, app: AppItems): UnplacedItem[] {
	const carried = new Set<string | undefined>([...vault.projects.map((p) => p.suiviId), ...vault.tasks.map((t) => t.blockId)]);
	const unreadable = Object.entries(vault.links).filter(([, link]) => link.unreadable);
	const unreadablePaths = new Set(unreadable.map(([path]) => path));
	const unreadableIds = new Set(unreadable.map(([, link]) => link.id));
	const out: UnplacedItem[] = [];
	for (const [id, p] of Object.entries(app.projects)) {
		if (p.archived || !p.triaged || carried.has(id) || unreadableIds.has(id) || unreadablePaths.has(p.base.path)) continue;
		out.push({ kind: "project", id, fields: p.current });
	}
	for (const [id, t] of Object.entries(app.tasks)) {
		const fields = t.current;
		const inUnreadable = unreadablePaths.has(t.base.path) || (fields.step && unreadableIds.has(fields.project_id ?? undefined));
		if (t.archived || !t.triaged || carried.has(id) || inUnreadable) continue;
		const projectTitle = fields.project_id ? (app.projects[fields.project_id]?.current.title ?? null) : null;
		out.push({ kind: "task", id, fields, projectTitle });
	}
	return out;
}

/** What an Unplaced item is, as its Inbox entry and the bulk modal describe it. */
export function unplacedDetail(item: UnplacedItem): string {
	if (item.kind === "project") return "Projet";
	if (!item.projectTitle) return "Tâche";
	return item.fields.step ? `Étape de ${item.projectTitle}` : `Tâche de ${item.projectTitle}`;
}

/**
 * « Retirer de l'app »: archives `items` in one Push, so the Client no longer
 * sees them. Returns the ids archived and the failures, each with its title.
 */
export async function removeFromApp(
	remote: Pick<Remote, "push">,
	items: UnplacedItem[],
): Promise<{ removed: string[]; failed: string[] }> {
	const results = await remote.push(items.map((i) => ({ op: "archive", kind: i.kind, id: i.id })));
	const out = { removed: [] as string[], failed: [] as string[] };
	items.forEach((item, i) => {
		const result = results[i];
		if (result?.ok) out.removed.push(item.id);
		else out.failed.push(`${item.fields.title} : ${result?.error ?? "pas de réponse"}`);
	});
	return out;
}
