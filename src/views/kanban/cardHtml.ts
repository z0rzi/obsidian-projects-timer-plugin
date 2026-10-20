import type { ProjectCard, ProjectCardItem } from "../../types";

const PLAY_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const DONE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

/** Dot on a card or step whose item has unread Client comments (Suivi Inbox); styled in styles.css. */
const UNREAD_DOT = '<span class="suivi-unread-dot" aria-label="Unread comments"></span>';

function escapeHtml(text: string): string {
	return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Card of a Tag task: title (`[x]` highlighted), body, done and play buttons. */
export function cardHtml(id: string, title: string, description: string, unread = false): string {
	const highlightedTitle = escapeHtml(title).replace(
		/\[(.+?)\]/g,
		'<span style="color: var(--text-faint)">[<span style="color: var(--card-color);">$1</span>]</span>',
	);
	return `
		<span>${unread ? UNREAD_DOT : ""}${highlightedTitle}</span>
		<br>
		<small>${escapeHtml(description).replace(/\n/g, "<br/>")}</small>
		<span class="kanban-card-actions">
			<span class="kanban-done-btn" data-task-id="${id}">${DONE_ICON}</span>
			<span class="kanban-play-btn" data-task-id="${id}">${PLAY_ICON}</span>
		</span>
		`;
}

function stepItemHtml(card: ProjectCard, item: ProjectCardItem, extraClass: string, unread: Set<string>): string {
	const classes = ["kanban-project-item", item.checked ? "is-checked" : "", extraClass].filter(Boolean).join(" ");
	return `
		<div class="${classes}" data-project-id="${card.id}" data-line="${item.line}">
			<input type="checkbox" class="kanban-project-item-checkbox" data-project-id="${card.id}" data-line="${item.line}" ${item.checked ? "checked" : ""} />
			<span class="kanban-project-item-text">${item.blockId && unread.has(item.blockId) ? UNREAD_DOT : ""}${escapeHtml(item.text)}</span>
		</div>
	`;
}

/** Card of an Override: the step itself, with its Project's name. */
export function overrideCardHtml(card: ProjectCard, item: ProjectCardItem, unread: Set<string>): string {
	return `
		${stepItemHtml(card, item, "", unread)}
		<small style="color: var(--text-faint)">${escapeHtml(card.file.basename)}</small>
		`;
}

/** `unread`: app ids with unread comments; `suiviId`: the Project's own. */
export function projectCardHtml(card: ProjectCard, unread: Set<string>, suiviId?: string): string {
	const itemsHtml = card.items
		.map((item) => stepItemHtml(card, item, item.override ? "is-override" : "", unread))
		.join("");
	return `
		<span style="font-weight: bold;">${suiviId && unread.has(suiviId) ? UNREAD_DOT : ""}${escapeHtml(card.file.basename)}</span>
		${itemsHtml}
		<span class="kanban-card-actions">
			<span class="kanban-play-btn" data-project-id="${card.id}">${PLAY_ICON}</span>
		</span>
		`;
}
