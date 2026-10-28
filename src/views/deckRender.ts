import { appLink, UPLOADED_IMAGE, withAbsoluteAppLinks } from "../comments/commentMarkdown";
import {
	currentItem,
	deckScreen,
	type DeckDecision,
	type DeckItem,
	type DeckKey,
	type DeckMessage,
	type DeckState,
} from "../deck/deckSession";
import { clientLine, DECK_FIELDS, projectSteps, zoneSteps, DECK_PRIORITIES, type DeckChoice, type DeckField } from "../deck/ticketLine";
import { URGENCY_LABELS } from "../inbox/inboxStore";
import {
	TRIAGE_TASK_TYPES,
	type InboxTicket,
	type Priority,
	type TicketUrgency,
	type TriagePriority,
	type TriageTaskType,
} from "../remote/api";

/**
 * What the Deck view shows, pure (no DOM, no Obsidian): the Ticket's side, the chips of its line, the key
 * legend, a card's recorded decision. The progress strip is `deckStripRender.ts`'s; the Sweep list, the end
 * screen and the report `deckListRender.ts`'s. `DeckView` renders them.
 */

/** What the Deck says of Zones it could not load from the app. */
const ZONES_UNLOADED = "zones non chargées";

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** An ISO date-time as a French weekday, day and time, local: « lundi 26 oct. 14:05 ». */
export function frenchDateTime(iso: string): string {
	const d = new Date(iso);
	const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

/**
 * The Ticket on the left of its card: its title; its urgency as a badge (`urgency` its colour), « Nouveau
 * chantier » as a neutral one (`urgency` null), none for a Ticket sent before the question; who sent it and
 * when; its description without its uploaded images, which come as thumbnails (`images`, once each, in order,
 * `src` their app URL, shown until their local copies replace it).
 */
export interface TicketSide {
	title: string;
	badge: { label: string; urgency: TicketUrgency | null } | null;
	byline: string;
	/** Markdown, its app links made absolute. */
	description: string;
	images: { path: string; alt: string; src: string }[];
}

export function ticketSide(ticket: InboxTicket, appUrl: string): TicketSide {
	const badge = ticket.urgency
		? { label: URGENCY_LABELS[ticket.urgency], urgency: ticket.urgency }
		: ticket.type === "idea"
			? { label: "Nouveau chantier", urgency: null }
			: null;
	const images = new Map<string, string>();
	for (const [, alt, path] of ticket.description.matchAll(UPLOADED_IMAGE)) if (!images.has(path!)) images.set(path!, alt!);
	return {
		title: ticket.title,
		badge,
		byline: `${ticket.author_email} · ${frenchDateTime(ticket.created_at)}`,
		description: withAbsoluteAppLinks(ticket.description.replace(UPLOADED_IMAGE, ""), appUrl).trim(),
		images: [...images].map(([path, alt]) => ({ path, alt, src: appLink(path, appUrl) })),
	};
}

const FIELD_LABELS: Record<DeckField, string> = { type: "Type", priority: "Priorité", project: "Projet", zone: "Zone" };

/** A Priority as the Deck's lists show it, as the app: P0 to P5, Rapide, Frigo, PR (a swept line's; Triage sets none). */
export function priorityLabel(p: Priority): string {
	return p === "pq" ? "Rapide" : p === "pr" ? "PR" : p === "pz" ? "Frigo" : `P${p}`;
}

/** A Priority on its chip, as the app shows it: P0 to P5, Rapide, Frigo. */
function priorityChipLabel(p: TriagePriority): string {
	return p === "pq" ? "Rapide" : p === "pz" ? "Frigo" : `P${p}`;
}

/** The key that sets a type or a Priority, shown on its chip. */
const TYPE_KEYS: Record<TriageTaskType, string> = { task: "t", bug: "b", quick: "q", wait: "w", idea: "i" };

const PRIORITY_KEYS: Record<TriagePriority, string> = { 0: "0", 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", pq: "q", pz: "z" };

/**
 * A value on a field's row: its label (a Zone's path apart, `detail`, shown faded), the key that sets it,
 * its colour (`type` for `data-type`, `priority` for `data-priority`), whether it is the chosen one, the
 * Client's (« client »), unknown here (`struck`: the Client's Project not in the vault) or `disabled` (Zones
 * not loaded).
 */
export interface DeckChip {
	label: string;
	detail: string | null;
	key: string | null;
	type: string | null;
	priority: string | null;
	selected: boolean;
	client: boolean;
	struck: boolean;
	disabled: boolean;
}

/**
 * A field of the line on the right: its chips (every type and Priority; for Project and Zone the one picked,
 * the Client's, none), `modified` when the chosen value is not the Client's, and `search` the key of the
 * full picker at its end.
 */
export interface DeckFieldRow {
	field: DeckField;
	label: string;
	/** The field `h`/`l` act on. */
	current: boolean;
	chips: DeckChip[];
	modified: boolean;
	search: "p" | "o" | null;
}

const chip = (label: string, patch: Partial<DeckChip> = {}): DeckChip => ({
	label,
	detail: null,
	key: null,
	type: null,
	priority: null,
	selected: false,
	client: false,
	struck: false,
	disabled: false,
	...patch,
});

/** The rows of a value list: a chip per value, `modified` when the selected one is not the Client's (none: never). */
function rowOf(chips: DeckChip[]): Pick<DeckFieldRow, "chips" | "modified"> {
	const proposed = chips.find((c) => c.client);
	return { chips, modified: !!proposed && !proposed.selected };
}

/** The fields of the current Ticket's line, empty once the session is over or on a Sweep item. */
export function fieldRows(state: DeckState): DeckFieldRow[] {
	const item = currentItem(state);
	if (!item || item.kind !== "ticket") return [];
	const { ticket } = item;
	const choice: DeckChoice = state.choices[ticket.id]!;
	const { context } = state;
	const client = clientLine(ticket, context);
	const picks = state.picks[ticket.id];
	const projectChips = projectSteps(choice, ticket, context, picks?.project).map((p) => {
		const title = p ? (context.projects.find((v) => v.path === p.path)?.title ?? p.path) : "aucun";
		const isClient = !!p && client.project !== "unknown" && client.project?.path === p.path;
		return chip(title, { selected: p?.path === choice.project?.path, client: isClient });
	});
	if (client.project === "unknown") projectChips.splice(-1, 0, chip("(pas dans le vault)", { client: true, struck: true }));
	const zoneChips = !context.zones
		? [chip(ZONES_UNLOADED, { disabled: true })]
		: zoneSteps(choice, ticket, context, picks?.zone).map((id) => {
				const zone = context.zones!.find((z) => z.id === id);
				return chip(zone?.name ?? "aucune", { detail: zone?.path || null, selected: id === (choice.zone ?? null), client: id !== null && id === client.zone });
			});
	const rows: Record<DeckField, Pick<DeckFieldRow, "chips" | "modified" | "search">> = {
		type: {
			...rowOf(TRIAGE_TASK_TYPES.map((t) => chip(`#${t}`, { key: TYPE_KEYS[t], type: t, selected: t === choice.type, client: t === client.type }))),
			search: null,
		},
		priority: {
			...rowOf(
				DECK_PRIORITIES.map((p) =>
					chip(priorityChipLabel(p), { key: PRIORITY_KEYS[p], priority: priorityKey(p), selected: p === choice.priority, client: p === client.priority }),
				),
			),
			search: null,
		},
		project: { ...rowOf(projectChips), search: "p" },
		zone: { ...rowOf(zoneChips), search: context.zones ? "o" : null },
	};
	return DECK_FIELDS.map((field) => ({ field, label: FIELD_LABELS[field], current: field === state.field, ...rows[field] }));
}

/** The Ticket's legend under the content, one line: moves and actions; the type and Priority keys are on their chips, `p` and `o` on their rows. */
export const DECK_LEGEND: { keys: DeckKey[]; label: string }[] = [
	{ keys: ["j", "k"], label: "champ" },
	{ keys: ["h", "l"], label: "valeur" },
	{ keys: ["Enter"], label: "écrire" },
	{ keys: ["x"], label: "archiver" },
	{ keys: ["s"], label: "passer" },
	{ keys: ["."], label: "comme le précédent" },
	{ keys: ["u"], label: "retour" },
];

const BACK: { keys: DeckKey[]; label: string } = { keys: ["u"], label: "retour" };

/** `YYYY-MM-DD` as « 04/11 », the day a keep goes to. */
export function shortDay(day: string): string {
	const [, month, date] = day.split("-");
	return `${date}/${month}`;
}

const LIST_MOVES: { keys: DeckKey[]; label: string } = { keys: ["j", "k"], label: "ligne" };

/**
 * The legend of the screen: the Sweep list's keys (Enter's day included), the Ticket's, the end screen's; none
 * with nothing to triage, nor once the session writes.
 */
export function deckLegend(state: DeckState): { keys: DeckKey[]; label: string }[] {
	if (state.phase !== "deciding") return [];
	switch (deckScreen(state)) {
		case "empty":
			return [];
		case "ticket":
			return DECK_LEGEND;
		case "end":
			return [LIST_MOVES, { keys: ["Enter"], label: "sur une ligne : la rouvrir" }, { keys: ["Enter"], label: "« Tout écrire »" }, BACK];
		case "sweep": {
			const first = state.items[0] as Extract<DeckItem, { kind: "sweep" }>;
			return [LIST_MOVES, { keys: ["z"], label: "au frigo" }, { keys: ["m"], label: "déplacer" }, { keys: ["Enter"], label: `garder jusqu'au ${shortDay(first.keepUntil)}` }, BACK];
		}
	}
}

/** A Ticket's decisions as the card and the end screen say them, with the end screen's icon. */
export const TICKET_ACTIONS: Record<Extract<DeckDecision, { kind: "write" | "archive" | "skip" }>["kind"], { icon: string; word: string }> = {
	write: { icon: "✎", word: "écrire" },
	archive: { icon: "🗄", word: "archiver" },
	skip: { icon: "⏭", word: "passer" },
};

/** What a Ticket's recorded decision does, in words: « écrire », « archiver (« déjà fait ») », « passer ». */
function decisionWords(decision: DeckDecision): string {
	if (decision.kind === "archive" && decision.comment) return `${TICKET_ACTIONS.archive.word} (« ${decision.comment} »)`;
	return decision.kind === "archive" || decision.kind === "skip" ? TICKET_ACTIONS[decision.kind].word : TICKET_ACTIONS.write.word;
}

/** The current card's recorded decision (« Décision : écrire »), null when it has none. */
export function decisionText(state: DeckState): string | null {
	if (currentItem(state)?.kind !== "ticket") return null;
	const decision = state.decisions[state.index];
	return decision ? `Décision : ${decisionWords(decision)}` : null;
}

/** The message the screen shows: the session's last, else why it has no Tickets (red, all along); null for none. */
export function deckMessage(state: DeckState): DeckMessage | null {
	if (state.message) return state.message;
	return state.ticketsError === null ? null : { kind: "error", text: `Tickets indisponibles : ${state.ticketsError}` };
}

/** The message line: information in blue after ⓘ, a failure in red (`styles.css`); null for no message. */
export function messageLine(message: DeckMessage | null): { text: string; cls: string } | null {
	if (!message) return null;
	return message.kind === "info"
		? { text: `ⓘ ${message.text}`, cls: "suivi-deck-message is-info" }
		: { text: message.text, cls: "suivi-deck-message is-error" };
}

/**
 * A Priority as the stylesheet knows it (`data-priority`, its colour `--priority-color`): `p0` to `p5`, `pq`
 * (Rapide), `pz` (the Frigo), `pr`.
 */
export function priorityKey(p: Priority): string {
	return typeof p === "number" ? `p${p}` : p;
}

/** The key name a keydown gives the session; null with Ctrl, Cmd or Alt, which stay Obsidian's. */
export function deckKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): string | null {
	return e.ctrlKey || e.metaKey || e.altKey ? null : e.key;
}
