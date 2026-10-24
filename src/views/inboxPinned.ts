import type { InboxEntry } from "../inbox/inboxStore";
import type { Conflict } from "../sync/compareState";
import type { UnplacedItem } from "../sync/unplaced";

/** The two buttons of a conflict, `[ P0 (moi) ]  [ P1 (jmj) ]`: the value first, who chose it in brackets. */
export function conflictButtons(c: Conflict): { choice: "mine" | "theirs"; text: string }[] {
	return [
		{ choice: "mine", text: `${c.mine.label} (moi)` },
		{ choice: "theirs", text: `${c.theirs.label} (${c.theirs.by ?? "Client"})` },
	];
}

/** The buttons of « Hors du vault »: « Insérer ici » and « Retirer de l'app » (several at once from the bulk modal). */
export interface UnplacedActions {
	insert(item: UnplacedItem): void;
	remove(items: UnplacedItem[]): void;
}

/** What the buttons of the Inbox's pinned entries do. */
export interface PinnedActions {
	/** "Insérer ici" on an entry À trier. */
	triage: (entry: InboxEntry) => void;
	/** "Nouveau projet" on a launched Idea À trier. */
	newProject: (entry: InboxEntry) => void;
	/** A conflict's button. */
	pick: (conflict: Conflict, choice: "mine" | "theirs") => void;
	unplaced: UnplacedActions;
}

/** « Insérer ici »: it keeps the note's cursor, so it must not take focus from the editor first. */
function insertButton(el: HTMLElement, label: string, onClick: () => void) {
	const insert = el.createEl("button", { text: "Insérer ici", attr: { "aria-label": label } });
	insert.onmousedown = (e) => e.preventDefault();
	insert.onclick = onClick;
}

/** The buttons of a Ticket À trier, an Unplaced item or a conflict, into its entry `el`. */
export function drawPinnedButtons(el: HTMLElement, entry: InboxEntry, actions: PinnedActions) {
	const toCursor = "Écrire cette Tâche au curseur de la note ouverte";
	const fromTemplate = "Créer la note du Projet depuis le modèle";
	if (entry.conflict) {
		const conflict = entry.conflict;
		for (const { choice, text } of conflictButtons(conflict)) {
			const button = el.createEl("button", { text });
			button.onclick = () => {
				button.disabled = true;
				actions.pick(conflict, choice);
			};
		}
	} else if (entry.unplaced) {
		const item = entry.unplaced;
		insertButton(el, item.kind === "project" ? fromTemplate : toCursor, () => actions.unplaced.insert(item));
		el.createEl("button", { text: "Retirer de l'app", attr: { "aria-label": "Archiver dans l'app : le Client ne le voit plus" } }).onclick =
			() => actions.unplaced.remove([item]);
	} else if (entry.kind === "ticket" && entry.ticketType === "idea") {
		el.createEl("button", { text: "Nouveau projet", attr: { "aria-label": fromTemplate } }).onclick = () => actions.newProject(entry);
	} else if (entry.kind === "ticket") {
		insertButton(el, toCursor, () => actions.triage(entry));
	}
}
