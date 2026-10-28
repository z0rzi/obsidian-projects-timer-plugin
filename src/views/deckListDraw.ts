import type { DeckMessage } from "../deck/deckSession";
import type { SweepLineContext } from "../deck/sweep";
import { messageLine } from "./deckRender";
import type { EndScreen, RowStatus, SweepList, SweepRow } from "./deckListRender";

/**
 * The DOM of the Deck's lists, drawn from the pure models of `deckListRender.ts`: the Sweep list, the end
 * screen and its report, « Rien à trier ». No inline style: every rule is in `styles.css` under `.suivi-deck-*`
 * (the colours on `data-priority`, `data-type`, `data-mark`, `data-tone`, the age bar's width on `data-age`, in
 * tenths).
 */

/** What a click on a list does: focus a Sweep row, open a note in a split, go on, reopen an end row, write, close, retry. */
export interface ListActions {
	focusRow(index: number): void;
	openNote(path: string): void;
	continueOn(): void;
	reopen(row: number): void;
	writeAll(): void;
	close(): void;
	retry(): void;
}

function drawMessage(el: HTMLElement, message: DeckMessage | null) {
	const line = messageLine(message);
	if (line) el.createEl("p", line);
}

/** The focused line in its note: heading, three faded lines on each side, the line and its body. */
function drawContext(el: HTMLElement, context: SweepLineContext | "missing") {
	const box = el.createDiv({ cls: "suivi-deck-sweep-context" });
	if (context === "missing") {
		box.createDiv({ ...messageLine({ kind: "info", text: "ligne introuvable dans la note" })! });
		return;
	}
	if (context.heading) box.createDiv({ text: context.heading, cls: "suivi-deck-sweep-heading" });
	for (const l of context.before) box.createDiv({ text: l, cls: "suivi-deck-sweep-faded" });
	for (const l of context.line) box.createDiv({ text: l, cls: "suivi-deck-sweep-line" });
	for (const l of context.after) box.createDiv({ text: l, cls: "suivi-deck-sweep-faded" });
}

function drawSweepRow(el: HTMLElement, row: SweepRow, actions: ListActions): HTMLElement {
	const rowEl = el.createDiv({ cls: ["suivi-deck-sweep-row", ...(row.focused ? ["is-focused"] : [])] });
	const head = rowEl.createDiv({ cls: "suivi-deck-sweep-head" });
	head.addEventListener("click", () => actions.focusRow(row.index));
	head.createSpan({ text: row.tag, cls: "suivi-deck-type-tag", attr: { "data-type": row.type } });
	head.createSpan({ text: row.title, cls: "suivi-deck-sweep-title" });
	head.createSpan({ text: row.priority.label, cls: "suivi-deck-chip is-selected", attr: { "data-priority": row.priority.key } });
	const bar = head.createSpan({ cls: "suivi-deck-age-bar" });
	bar.createSpan({ cls: "suivi-deck-age-fill", attr: { "data-age": String(Math.round(row.ageFraction * 10)) } });
	head.createSpan({ text: row.age, cls: "suivi-deck-age" });
	const decision = head.createSpan({ cls: "suivi-deck-sweep-decision" });
	if (row.decision) decision.createSpan({ text: row.decision.label, attr: { "data-mark": row.decision.mark } });
	if (row.notPushed) decision.createSpan({ text: "⚠ non poussée", cls: "suivi-deck-not-pushed" });
	if (row.context) drawContext(rowEl, row.context);
	return rowEl;
}

/** The Sweep list into `el`: the message, the lines by note, « Continuer »; the focused row scrolled into view. */
export function drawSweepList(el: HTMLElement, list: SweepList, message: DeckMessage | null, actions: ListActions) {
	el.empty();
	drawMessage(el, message);
	const box = el.createDiv({ cls: "suivi-deck-sweep" });
	let focused: HTMLElement | null = null;
	for (const group of list.groups) {
		const header = box.createDiv({ cls: "suivi-deck-sweep-note" });
		header.createSpan({ text: group.header, cls: "suivi-deck-sweep-note-title" });
		const open = header.createEl("a", { text: "↗ ouvrir", cls: "suivi-deck-sweep-open", href: "#" });
		open.addEventListener("click", (e) => {
			e.preventDefault();
			actions.openNote(group.path);
		});
		for (const row of group.rows) {
			const rowEl = drawSweepRow(box, row, actions);
			if (row.focused) focused = rowEl;
		}
	}
	const next = box.createDiv({ text: list.continueRow.label, cls: ["suivi-deck-sweep-continue", ...(list.continueRow.focused ? ["is-focused"] : [])] });
	next.addEventListener("click", () => actions.continueOn());
	if (list.continueRow.focused) focused = next;
	focused?.scrollIntoView({ block: "nearest" });
}

function drawStatus(el: HTMLElement, status: RowStatus) {
	if (status) el.createSpan({ text: status.text, cls: "suivi-deck-status", attr: { "data-tone": status.tone } });
}

/** The end screen into `el` (the report once the session writes): Tickets, the Sweep by outcome, its buttons. */
export function drawEndScreen(el: HTMLElement, end: EndScreen, message: DeckMessage | null, actions: ListActions) {
	el.empty();
	drawMessage(el, message);
	const box = el.createDiv({ cls: "suivi-deck-end" });
	let row = 0;
	const rowEl = (focused: boolean, cls: string) => {
		const at = row++;
		const r = box.createDiv({ cls: ["suivi-deck-end-row", cls, ...(focused ? ["is-focused"] : [])] });
		if (end.write) r.addEventListener("click", () => actions.reopen(at));
		return r;
	};
	if (end.tickets.length > 0) box.createDiv({ text: "Tickets", cls: "suivi-deck-end-heading" });
	for (const t of end.tickets) {
		const r = rowEl(t.focused, "is-ticket");
		r.createSpan({ text: t.type ? `#${t.type}` : "", cls: "suivi-deck-type-tag", attr: t.type ? { "data-type": t.type } : {} });
		r.createSpan({ text: t.title, cls: "suivi-deck-end-title" });
		if (t.priority) r.createSpan({ text: t.priority.label, cls: "suivi-deck-chip is-selected", attr: { "data-priority": t.priority.key } });
		else r.createSpan({ text: "—", cls: "suivi-deck-end-none" });
		r.createSpan({ text: t.action, cls: "suivi-deck-end-action" });
		drawStatus(r, t.status);
	}
	if (end.sweep.length > 0) box.createDiv({ text: "Balayage", cls: "suivi-deck-end-heading" });
	for (const g of end.sweep) {
		const r = rowEl(g.focused, "is-sweep");
		r.createSpan({ text: g.label, cls: "suivi-deck-end-group", attr: { "data-mark": g.mark } });
		const lines = r.createSpan({ cls: "suivi-deck-end-lines" });
		for (const l of g.lines) {
			const line = lines.createSpan({ cls: "suivi-deck-end-line" });
			line.createSpan({ text: l.detail ? `${l.title} ${l.detail}` : l.title });
			drawStatus(line, l.status);
		}
	}
	if (end.push) box.createDiv({ text: end.push.text, cls: "suivi-deck-status suivi-deck-end-push", attr: { "data-tone": end.push.tone } });
	const buttons = el.createDiv({ cls: "suivi-deck-end-buttons" });
	if (end.write) {
		const write = buttons.createEl("button", { text: end.write.label, cls: ["mod-cta", ...(end.write.focused ? ["is-focused"] : [])] });
		write.addEventListener("click", () => actions.writeAll());
		return;
	}
	if (!end.finished) return;
	if (end.retry) buttons.createEl("button", { text: "Réessayer les échecs" }).addEventListener("click", () => actions.retry());
	const close = buttons.createEl("button", { text: "Fermer", cls: "mod-cta" });
	close.addEventListener("click", () => actions.close());
}

/** « Rien à trier »: one muted line and « Fermer »; no legend, no notice. */
export function drawNothing(el: HTMLElement, close: () => void) {
	el.empty();
	const box = el.createDiv({ cls: "suivi-deck-nothing" });
	box.createEl("h2", { text: "Rien à trier" });
	box.createEl("p", { text: "Aucun ticket en attente ; le balayage passe une fois par jour.", cls: "suivi-deck-nothing-line" });
	box.createEl("button", { text: "Fermer", cls: "mod-cta" }).addEventListener("click", close);
}
