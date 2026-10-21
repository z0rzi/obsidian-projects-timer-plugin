import type { ActivityEntry } from "../remote/api";

const ANSWERS: Record<NonNullable<ActivityEntry["answer"]>, string> = { valide: "Validé", a_reprendre: "À reprendre" };

/** `P2`, or "hérité" for a Project step that had no priority of its own. */
const priorityLabel = (value: unknown) => (typeof value === "number" ? `P${value}` : "hérité");

/** How a toast names a user: a short handle upper-cased ("JMJ"), a longer one capitalised, else the email's local part. */
function actorName(actor: ActivityEntry["actor"]): string {
	const name = actor.handle ?? actor.email.split("@")[0] ?? actor.email;
	return name.length <= 3 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
}

/** Text of the toast shown when a Pull brought this Client entry, e.g. "JMJ a commenté Algo détection". */
export function toastText(entry: ActivityEntry): string {
	const title = entry.item?.title ?? "";
	switch (entry.type) {
		case "comment.created":
			return `${actorName(entry.actor)} a commenté ${title}`;
		case "item.updated":
			if (entry.field === "priority") return `${priorityLabel(entry.from)} → ${priorityLabel(entry.to)} sur ${title}`;
			break;
		case "ticket.created":
			return `Nouveau ticket : ${title}`;
		case "review.answered":
			if (entry.answer) return `Revue ${title} : ${ANSWERS[entry.answer]}`;
			break;
	}
	return title ? `${entry.label} : ${title}` : entry.label;
}
