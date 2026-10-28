import { TRIAGE_TASK_TYPES, type InboxTicket, type TriagePriority, type TriageTaskType, type Zone } from "../remote/api";
import type { VaultProject } from "../inbox/inboxStore";

/**
 * A Ticket's line in the Deck (`deckSession.ts`), pure: the choice Triage writes, the defaults the Client's
 * answers propose, the values `h`/`l` go through.
 *
 * The Rapide rule (a `quick` is never ranked, Rapide is only a `quick`'s),
 * kept by every change so a choice is always one the app accepts:
 * - a rank (`0`–`5`) on a `quick` makes it a `task`;
 * - Rapide (`q`, or `h`/`l` onto it) makes it a `quick`;
 * - `quick` as the type (`h`/`l` onto it) turns a rank into Rapide; `pz` stays;
 * - another type turns Rapide into the default Priority of that type for the Ticket's Urgency;
 * - `pz` goes with any type.
 */

/** The fields of a Ticket's line, top to bottom (`j`/`k`). */
export const DECK_FIELDS = ["type", "priority", "project", "zone"] as const;

export type DeckField = (typeof DECK_FIELDS)[number];

/** The Priorities `h`/`l` go through, in this order. */
export const DECK_PRIORITIES: TriagePriority[] = [0, 1, 2, 3, 4, 5, "pq", "pz"];

/**
 * What Triage writes for a Ticket. `project` null: none; `zone` null: none,
 * absent: the Client's suggestion stays (the session knows no Zones).
 */
export interface DeckChoice {
	type: TriageTaskType;
	priority: TriagePriority;
	project: { path: string; id: string } | null;
	zone?: number | null;
}

/**
 * A Ticket's own value on its Projet and Zone rows, their first chip: the latest one chosen that is not the
 * Client's (picked with `p`/`o`, by `.`, or a recorded line), kept when `h`/`l` move off it; null: none yet.
 */
export interface RowPicks {
	project: DeckChoice["project"];
	zone: number | null;
}

/**
 * What a session may pick from: the Project notes a Task may join (by title)
 * and the app's Zones (in its order); `zones` null when the app's state could
 * not be loaded, the Zone then left to the app (the Client's suggestion).
 */
export interface DeckContext {
	projects: VaultProject[];
	zones: Zone[] | null;
}

/** The Client's answers the Deck's default Priority follows. */
export type PriorityHints = Pick<InboxTicket, "urgency" | "requested_priority">;

/**
 * The Priority the Client's answers suggest for a Ticket of `type`: Bloquant
 * always p0; a Nouveau chantier and Pour plus tard the Frigo; Gênant a bug the
 * Frigo (the Developer makes it a Rapide or a rank when it is quick), a Retouche
 * Rapide, anything else the Priority the Client chose, p2 without one; no
 * Urgency p3 (a Retouche Rapide).
 */
export function suggestedPriority(hints: PriorityHints, type: TriageTaskType): TriagePriority {
	if (hints.urgency === "bloquant") return 0;
	if (type === "idea" || hints.urgency === "plus_tard") return "pz";
	if (type === "quick") return "pq";
	if (hints.urgency === "genant") return type === "bug" ? "pz" : (hints.requested_priority ?? 2);
	return 3;
}

/** The type Triage proposes for the app's `type`: the same when it is a Tag task's, else a task. */
function deckType(type: string): TriageTaskType {
	return TRIAGE_TASK_TYPES.find((t) => t === type) ?? "task";
}

/** `choice` with `priority`, the type following the Rapide rule. */
export function withPriority(choice: DeckChoice, priority: TriagePriority): DeckChoice {
	if (priority === "pq") return { ...choice, priority, type: "quick" };
	if (typeof priority === "number" && choice.type === "quick") return { ...choice, priority, type: "task" };
	return { ...choice, priority };
}

/** `choice` with `type`, the Priority following the Rapide rule (`hints`: the Ticket's, for the default). */
export function withType(choice: DeckChoice, type: TriageTaskType, hints: PriorityHints): DeckChoice {
	if (type === "quick") return { ...choice, type, priority: typeof choice.priority === "number" ? "pq" : choice.priority };
	if (choice.priority === "pq") return { ...choice, type, priority: suggestedPriority(hints, type) };
	return { ...choice, type };
}

/**
 * The line the Ticket's hints propose: type, Priority, and the Project and
 * Zone the Client named when they exist here; no Zone at all when the Zones
 * are unknown, so the app keeps the Client's.
 */
export function defaultChoice(ticket: InboxTicket, context: DeckContext): DeckChoice {
	const type = deckType(ticket.type);
	const project = context.projects.find((p) => p.id === ticket.project_id);
	const base: DeckChoice = { type, priority: 3, project: project ? { path: project.path, id: project.id } : null };
	if (context.zones) base.zone = context.zones.find((z) => z.id === ticket.zone_id)?.id ?? null;
	return withPriority(base, suggestedPriority(ticket, type));
}

/**
 * What the Client's answers propose for a Ticket, as the Deck marks it
 * « client » on its chips: the type (none when the app's is not a Tag task's),
 * the Priority they suggest for it, the Project he named (`unknown`: not a
 * Project note here; null: « Je ne sais pas ») and his Zone (null: none, or
 * not one of the app's Zones).
 */
export interface ClientLine {
	type: TriageTaskType | null;
	priority: TriagePriority;
	project: VaultProject | "unknown" | null;
	zone: number | null;
}

export function clientLine(ticket: InboxTicket, context: DeckContext): ClientLine {
	const type = TRIAGE_TASK_TYPES.find((t) => t === ticket.type) ?? null;
	const project = ticket.project_id === null ? null : (context.projects.find((p) => p.id === ticket.project_id) ?? "unknown");
	return {
		type,
		priority: suggestedPriority(ticket, deckType(ticket.type)),
		project,
		zone: context.zones?.find((z) => z.id === ticket.zone_id)?.id ?? null,
	};
}

/** The Client's Project as a line's, when it is a Project note here; null otherwise. */
export function clientProject(ticket: InboxTicket, context: DeckContext): DeckChoice["project"] {
	const proposed = clientLine(ticket, context).project;
	return proposed && proposed !== "unknown" ? { path: proposed.path, id: proposed.id } : null;
}

/**
 * The Projects `h`/`l` go through on a Ticket, as its Projet row shows them: its own (the one chosen when it is
 * neither the Client's nor none, else `pick`, the last one picked), the Client's when it is a Project note
 * here, none. The others are the picker's (`p`).
 */
export function projectSteps(choice: DeckChoice, ticket: InboxTicket, context: DeckContext, pick: DeckChoice["project"] = null): DeckChoice["project"][] {
	const client = clientProject(ticket, context);
	const own = [choice.project, pick].find((p) => p && p.path !== client?.path);
	return [...(own ? [own] : []), ...(client ? [client] : []), null];
}

/** The Zones `h`/`l` go through, as `projectSteps`: its own, the Client's, none; none at all when the Zones are not loaded. */
export function zoneSteps(choice: DeckChoice, ticket: InboxTicket, context: DeckContext, pick: number | null = null): (number | null)[] {
	if (!context.zones) return [];
	const client = clientLine(ticket, context).zone;
	const own = [choice.zone ?? null, pick].find((z) => z !== null && z !== client);
	return [...(own !== undefined ? [own] : []), ...(client !== null ? [client] : []), null];
}

/**
 * `choice` with the value of `field` one step (`h`: -1, `l`: +1) along its list, stopping at its ends: every type
 * and Priority, the Projects and Zones of the row (`projectSteps`, `zoneSteps`).
 */
export function stepValue(choice: DeckChoice, field: DeckField, step: number, ticket: InboxTicket, context: DeckContext, picks?: RowPicks): DeckChoice {
	const along = <T>(values: T[], index: number): T => values[Math.max(0, Math.min(values.length - 1, index + step))]!;
	switch (field) {
		case "type":
			return withType(choice, along([...TRIAGE_TASK_TYPES], TRIAGE_TASK_TYPES.indexOf(choice.type)), ticket);
		case "priority":
			return withPriority(choice, along(DECK_PRIORITIES, DECK_PRIORITIES.indexOf(choice.priority)));
		case "project": {
			const projects = projectSteps(choice, ticket, context, picks?.project);
			return { ...choice, project: along(projects, projects.findIndex((p) => p?.path === choice.project?.path)) };
		}
		case "zone": {
			const zones = zoneSteps(choice, ticket, context, picks?.zone);
			if (zones.length === 0) return choice;
			return { ...choice, zone: along(zones, zones.indexOf(choice.zone ?? null)) };
		}
	}
}
