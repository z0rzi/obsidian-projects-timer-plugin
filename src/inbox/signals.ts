import { dueDateLabel } from "../dueDate";
import type { ActivityEntry } from "../remote/api";

const ANSWERS: Record<NonNullable<ActivityEntry["answer"]>, string> = { valide: "Validé", a_reprendre: "À reprendre" };

/** `P2`, or "hérité" for a Project step that had no priority of its own. */
const priorityLabel = (value: unknown) => (typeof value === "number" ? `P${value}` : "hérité");

/** An Échéance as the app words it, « mars 2027 »; « retirée » for none. */
const dueDateBadge = (value: unknown) => (typeof value === "string" ? dueDateLabel(value) : "retirée");

/** How a toast names a user: a short handle upper-cased ("JMJ"), a longer one capitalised, else the email's local part. */
function actorName(actor: ActivityEntry["actor"]): string {
	const name = actor.handle ?? actor.email.split("@")[0] ?? actor.email;
	return name.length <= 3 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
}

/** Text of the toast shown for a Client entry new since the Inbox's previous load (after a Pull), e.g. "JMJ a commenté Algo détection". */
export function toastText(entry: ActivityEntry): string {
	const title = entry.item?.title ?? "";
	switch (entry.type) {
		case "comment.created":
			return `${actorName(entry.actor)} a commenté ${title}`;
		case "item.updated":
			if (entry.field === "priority") return `${priorityLabel(entry.from)} → ${priorityLabel(entry.to)} sur ${title}`;
			// The app words it: « Échéance repoussée à mars 2027 ».
			if (entry.field === "due_date") return `${entry.label} sur ${title}`;
			break;
		case "ticket.created":
			return `Nouveau ticket : ${title}`;
		case "item.answered":
			if (entry.answer) return `${actorName(entry.actor)} : ${ANSWERS[entry.answer]} sur ${title}`;
			break;
	}
	return title ? `${entry.label} : ${title}` : entry.label;
}

/**
 * Text of a kanban card's badge from its item's unread entries (newest first, as
 * `InboxStore.unreadByItem` gives them), e.g. "💬 2 · P1→P2": comments counted,
 * the priority move from the oldest change to the newest, the newest Échéance
 * (« 📅 retirée » once removed), the latest Answer on the Task or Project, then
 * a count of anything else.
 */
export function badgeText(entries: ActivityEntry[]): string {
	const comments = entries.filter((e) => e.type === "comment.created");
	const priorities = entries.filter((e) => e.type === "item.updated" && e.field === "priority");
	const dueDates = entries.filter((e) => e.type === "item.updated" && e.field === "due_date");
	const answers = entries.filter((e) => e.type === "item.answered" && e.answer);
	const answer = answers[0]?.answer;
	const others = entries.length - comments.length - priorities.length - dueDates.length - answers.length;
	const parts: string[] = [];
	if (comments.length) parts.push(`💬 ${comments.length}`);
	const newest = priorities[0];
	const oldest = priorities.at(-1);
	if (newest && oldest) parts.push(`${priorityLabel(oldest.from)}→${priorityLabel(newest.to)}`);
	const dueDate = dueDates[0];
	if (dueDate) parts.push(`📅 ${dueDateBadge(dueDate.to)}`);
	if (answer) parts.push(ANSWERS[answer]);
	if (others > 0) parts.push(`🔔 ${others}`);
	return parts.join(" · ");
}
