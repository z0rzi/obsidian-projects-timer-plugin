import type { Component } from "obsidian";
import type { DeckState } from "../deck/deckSession";
import { decisionText, deckLegend, deckMessage, fieldRows, messageLine, type DeckChip, type TicketSide } from "./deckRender";
import { progressStrip } from "./deckStripRender";

/**
 * The Deck view's DOM, drawn from the pure helpers of `deckRender.ts`. No inline style: every rule is in
 * `styles.css` under `.suivi-deck-*`, on the theme's colours (the Priority, urgency, type and message colours
 * are set there once, on `data-priority`, `data-urgency`, `data-type` and `data-mark`).
 */

/**
 * The progress strip, the two sides and the legend of the Deck in `root`, emptied first; `go` gets the index of a
 * reached dot clicked.
 */
export function drawLayout(
	root: HTMLElement,
	go: (index: number) => void,
): { strip: HTMLElement; left: HTMLElement; right: HTMLElement; legend: HTMLElement } {
	root.empty();
	const strip = root.createDiv({ cls: "suivi-deck-strip" });
	strip.addEventListener("click", (e) => {
		const dot = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(".suivi-deck-dot.is-reached") : null;
		if (dot?.dataset.index) go(Number(dot.dataset.index));
	});
	const body = root.createDiv({ cls: "suivi-deck-body" });
	const left = body.createDiv({ cls: "suivi-deck-ticket" });
	const right = body.createDiv({ cls: "suivi-deck-fields" });
	const legend = root.createDiv({ cls: "suivi-deck-legend" });
	return { strip, left, right, legend };
}

/** The progress strip into `el`: a dot per card by step, coloured by its decision, the current one ringed; where the session is and its tally. */
export function drawStrip(el: HTMLElement, state: DeckState) {
	el.empty();
	const strip = progressStrip(state);
	if (!strip) return;
	const dots = el.createDiv({ cls: "suivi-deck-dots" });
	for (const group of strip.groups) {
		const groupEl = dots.createDiv({ cls: "suivi-deck-dot-group", attr: { "data-step": group.kind } });
		for (const dot of group.dots) {
			const cls = ["suivi-deck-dot", ...(dot.current ? ["is-current"] : []), ...(dot.reached ? ["is-reached"] : [])];
			const attr: Record<string, string> = { "data-index": String(dot.index), "data-mark": dot.mark, "aria-label": dot.title, title: dot.title };
			if (dot.priority) attr["data-priority"] = dot.priority;
			groupEl.createSpan({ cls, attr });
		}
	}
	el.createSpan({ text: strip.position, cls: "suivi-deck-position" });
	if (strip.tally) el.createSpan({ text: strip.tally, cls: "suivi-deck-tally" });
}

/** The key legend of the current item into `el`. */
export function drawLegend(el: HTMLElement, state: DeckState) {
	el.empty();
	for (const { keys, label } of deckLegend(state)) {
		const entry = el.createSpan({ cls: "suivi-deck-legend-entry" });
		for (const key of keys) entry.createEl("kbd", { text: key === "Enter" ? "Entrée" : key });
		entry.appendText(` ${label}`);
	}
}

/** The head of the Ticket on the left: its title with its urgency badge, who sent it and when. */
export function drawTicketHead(el: HTMLElement, side: TicketSide) {
	const head = el.createDiv({ cls: "suivi-deck-ticket-head" });
	head.createEl("h2", { text: side.title, cls: "suivi-deck-ticket-title" });
	if (side.badge) head.createSpan({ text: side.badge.label, cls: "suivi-deck-badge", attr: side.badge.urgency ? { "data-urgency": side.badge.urgency } : {} });
	el.createDiv({ text: side.byline, cls: "suivi-deck-sender" });
}

/** A chip with its key, its colour, and the « client » mark under it. */
function drawChip(el: HTMLElement, chip: DeckChip) {
	const slot = el.createDiv({ cls: "suivi-deck-chip-slot" });
	const attr: Record<string, string> = {};
	if (chip.type) attr["data-type"] = chip.type;
	if (chip.priority) attr["data-priority"] = chip.priority;
	const cls = [
		"suivi-deck-chip",
		...(chip.selected ? ["is-selected"] : []),
		...(chip.struck ? ["is-struck"] : []),
		...(chip.disabled ? ["is-disabled"] : []),
		...(chip.type ? ["has-type"] : []),
	];
	const chipEl = slot.createSpan({ cls, attr });
	chipEl.createSpan({ text: chip.label, cls: "suivi-deck-chip-label" });
	if (chip.detail) chipEl.createSpan({ text: chip.detail, cls: "suivi-deck-chip-detail" });
	if (chip.key) chipEl.createSpan({ text: chip.key, cls: "suivi-deck-chip-key" });
	if (chip.client) slot.createSpan({ text: "client", cls: "suivi-deck-client" });
}

/**
 * The right side: the card's recorded decision, the rows of the current Ticket's line (its chips, « modifié »
 * and the picker's key at their end), the session's message under them.
 */
export function drawFields(el: HTMLElement, state: DeckState) {
	el.empty();
	const message = messageLine(deckMessage(state));
	const decided = decisionText(state);
	if (decided) el.createEl("p", { text: decided, cls: "suivi-deck-decision" });
	for (const row of fieldRows(state)) {
		const box = el.createDiv({ cls: ["suivi-deck-field", ...(row.current ? ["is-current"] : [])], attr: { "data-field": row.field } });
		box.createDiv({ text: row.label, cls: "suivi-deck-field-label" });
		const chips = box.createDiv({ cls: "suivi-deck-chips" });
		for (const chip of row.chips) drawChip(chips, chip);
		if (row.modified || row.search) {
			const end = box.createDiv({ cls: "suivi-deck-field-end" });
			if (row.modified) end.createSpan({ text: "modifié", cls: "suivi-deck-modified" });
			if (row.search) end.createEl("kbd", { text: row.search, attr: { "aria-label": row.search === "p" ? "chercher un projet" : "chercher une zone" } });
		}
	}
	if (message) el.createEl("p", message);
}

/**
 * The Ticket's images as thumbnails into `el`, `open` on a click (full size): first from the app, as the
 * description gave them, then from their local copies once fetched (`localUrls`; uploads need a session:
 * Obsidian may not load them from the app), swapped in place. The clicks go with `scope`, the Ticket's.
 */
export function drawThumbnails(
	el: HTMLElement,
	images: TicketSide["images"],
	scope: Component,
	load: { localUrls(paths: string[]): Promise<Map<string, string>>; open(src: string, alt: string): void },
) {
	const shown = images.map(({ path, alt, src }) => {
		const thumb = el.createDiv({ cls: "suivi-deck-thumb" });
		const img = thumb.createEl("img", { attr: { src, alt } });
		scope.registerDomEvent(thumb, "click", () => load.open(img.src, alt));
		return { path, img };
	});
	void load.localUrls(images.map((i) => i.path)).then((urls) => {
		if (!el.isConnected) return;
		for (const { path, img } of shown) {
			const url = urls.get(path);
			if (url) img.src = url;
		}
	});
}
