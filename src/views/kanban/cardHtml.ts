import type { ProjectCard, ProjectCardItem, TaskTagLabel } from "../../types";

const PLAY_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const DONE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

/** Marker on a Project card's step line whose item has unread Inbox entries; styled in styles.css. */
const UNREAD_DOT = '<span class="suivi-unread-dot" aria-label="Unread Inbox entries"></span>';

/** Card label per type; a plain task has none. */
const TYPE_LABELS: Partial<Record<TaskTagLabel, string>> = { bug: "BUG", quick: "RAPIDE", wait: "ATTENTE" };

/** Small type label in the type's colour (styles.css), empty for a task. */
function typeLabelHtml(type: TaskTagLabel): string {
	const label = TYPE_LABELS[type];
	return label ? `<span class="kanban-type-label" data-type="${type}">${label}</span>` : "";
}

/** Dot before a step's text in its type's colour (styles.css), empty for a task. */
function typeDotHtml(type: TaskTagLabel): string {
	return TYPE_LABELS[type] ? `<span class="kanban-step-dot" data-type="${type}"></span>` : "";
}

function escapeHtml(text: string): string {
	return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Unread badge of a card: app id of its item and the text built by `badgeText`. */
export type CardBadge = { itemId: string; text: string };

/** Badge at the top right of a card (tints it, see styles.css); a click opens the Inbox on `itemId`. */
function badgeHtml(badge: CardBadge | undefined): string {
	return badge ? `<span class="suivi-badge" data-item-id="${badge.itemId}">${escapeHtml(badge.text)}</span>` : "";
}

/** The badge of app id `itemId`, if `badges` (badge text by item id) has one. */
export function badgeOf(badges: Map<string, string>, itemId: string | undefined): CardBadge | undefined {
	const text = itemId ? badges.get(itemId) : undefined;
	return itemId && text ? { itemId, text } : undefined;
}

/** Card of a Tag task: unread badge, type label, title (`[x]` highlighted), body, done and play buttons. */
export function cardHtml(id: string, title: string, description: string, type: TaskTagLabel, badge?: CardBadge): string {
	const highlightedTitle = escapeHtml(title).replace(
		/\[(.+?)\]/g,
		'<span style="color: var(--text-faint)">[<span style="color: var(--card-color);">$1</span>]</span>',
	);
	return `
		${badgeHtml(badge)}
		${typeLabelHtml(type)}
		<span>${highlightedTitle}</span>
		<br>
		<small>${escapeHtml(description).replace(/\n/g, "<br/>")}</small>
		<span class="kanban-card-actions">
			<span class="kanban-done-btn" data-task-id="${id}">${DONE_ICON}</span>
			<span class="kanban-play-btn" data-task-id="${id}">${PLAY_ICON}</span>
		</span>
		`;
}

/** A step line; `marked`: its item has unread entries. */
function stepItemHtml(card: ProjectCard, item: ProjectCardItem, extraClass: string, marked: boolean): string {
	const classes = ["kanban-project-item", item.checked ? "is-checked" : "", extraClass].filter(Boolean).join(" ");
	return `
		<div class="${classes}" data-project-id="${card.id}" data-line="${item.line}" data-type="${item.type}">
			<input type="checkbox" class="kanban-project-item-checkbox" data-project-id="${card.id}" data-line="${item.line}" ${item.checked ? "checked" : ""} />
			${typeDotHtml(item.type)}<span class="kanban-project-item-text">${marked ? UNREAD_DOT : ""}${escapeHtml(item.text)}</span>
		</div>
	`;
}

/** Card of an Override: unread badge, the step itself, its body, with its Project's name. */
export function overrideCardHtml(card: ProjectCard, item: ProjectCardItem, badges: Map<string, string>): string {
	return `
		${badgeHtml(badgeOf(badges, item.blockId))}
		${stepItemHtml(card, item, "", false)}
		<small>${escapeHtml(item.body.trim()).replace(/\n/g, "<br/>")}</small>
		<small style="color: var(--text-faint)">${escapeHtml(card.file.basename)}</small>
		`;
}

/** `badges`: badge text by app id of the items with unread entries; `suiviId`: the Project's own. */
export function projectCardHtml(card: ProjectCard, badges: Map<string, string>, suiviId?: string): string {
	const itemsHtml = card.items
		.map((item) =>
			stepItemHtml(card, item, item.override ? "is-override" : "", !!item.blockId && badges.has(item.blockId)),
		)
		.join("");
	return `
		${badgeHtml(badgeOf(badges, suiviId))}
		<span style="font-weight: bold;">${escapeHtml(card.file.basename)}</span>
		${itemsHtml}
		<span class="kanban-card-actions">
			<span class="kanban-play-btn" data-project-id="${card.id}">${PLAY_ICON}</span>
		</span>
		`;
}
