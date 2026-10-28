import { Component, ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";
import { AppImages } from "../comments/appImages";
import { commitCards, type CommitDeps } from "../deck/deckCommit";
import {
	currentItem,
	deckScreen,
	decisionCount,
	goTo,
	moveTo,
	press,
	type DeckEffect,
	type DeckScreen,
	type DeckState,
	type DeckStep,
} from "../deck/deckSession";
import { cardDone, commitDone, retryFailed } from "../deck/deckEnd";
import { sweepCount, withSweepLines } from "../deck/sweepSession";
import { localDay } from "../localDate";
import type { PushOutcome } from "../sync/runPush";
import { confirmDiscard } from "../ui/DiscardModal";
import { ImageModal } from "../ui/ImageModal";
import { tickUnlessUnloaded } from "../ui/nextTick";
import { drawFields, drawLayout, drawLegend, drawStrip, drawThumbnails, drawTicketHead } from "./deckDraw";
import { drawEndScreen, drawNothing, drawSweepList, type ListActions } from "./deckListDraw";
import { endScreen, sweepList } from "./deckListRender";
import { pushReport } from "../deck/pushReport";
import { deckKey, deckMessage, messageLine, ticketSide } from "./deckRender";
import { openEffectModal, readSweepLines, type DeckModalHost } from "./deckModals";
import { typeColorsCss } from "./kanban/boards";

export const DECK_VIEW_TYPE = "suivi-deck-view";

/** How long a brief message (« comme le précédent ») stays on the message line. */
const BRIEF_MESSAGE_MS = 2000;

/** What the Deck view needs from the plugin: a session, the writes its commit runs (`deckCommit.ts`), its end. */
export interface DeckViewDeps extends CommitDeps {
	/** A session: the items to go through and what to pick from; a resumed one as it was left. */
	load(): Promise<DeckState>;
	/** The closing Push of what the Sweep wrote, once the cards are written; null when there was nothing to push. */
	push(): Promise<PushOutcome | null>;
	/** The session is written, or the view closed: anything the Sweep wrote not pushed yet is, the Inbox reloads. */
	finish(): void;
	/** The view closed (its tab, not Escape) with decisions not written: the plugin asks whether to drop them or resume `state`. */
	closedWithDecisions(state: DeckState): void;
	appUrl(): string;
	fetchImage: ConstructorParameters<typeof AppImages>[0];
}

/**
 * The Deck: Triage as a session, one Ticket at a time (spec « Deck »). On
 * top, the progress strip: a dot per card, coloured by its decision, a click
 * on a reached one going there, with the place and the tally. Left, the
 * Ticket, scrolling on its own: title and urgency badge, who sent it and when,
 * the description, its images as thumbnails (full size on a click); right,
 * the rows of the line, each chip with its key, the Client's marked, and the
 * card's recorded decision; under them, the keys. The day's first session opens
 * on the Sweep list, full width: its lines by note, the focused one open in
 * its note (read once per note when the list opens), its own legend. Past the
 * last card, the end screen lists the decisions; « Tout écrire » writes them
 * all, each row then showing its result, and the screen becomes the report
 * (the closing Push's result, « Fermer », « Réessayer les échecs »). With
 * nothing to triage, « Rien à trier ». Escape, or closing the tab, with
 * decisions recorded asks before dropping them. A thin view: keys go to the
 * session (`deck/deckSession.ts`), the effects it returns are run here.
 */
export class DeckView extends ItemView {
	private state: DeckState | null = null;
	private readonly images: AppImages;
	/** Owner of the description's rendered Markdown and the thumbnails' clicks, unloaded with the Ticket. */
	private renderScope: Component | null = null;
	/** The item the left side shows, so a key redraws only the right side; -1 when it shows a list. */
	private shownIndex = -1;
	/** The screen last drawn: entering the Sweep list reads its notes. */
	private shownScreen: DeckScreen | null = null;
	private strip: HTMLElement | null = null;
	private left: HTMLElement | null = null;
	private right: HTMLElement | null = null;
	private legend: HTMLElement | null = null;
	/** What the legend is for (the screen and the phase), so it is redrawn only when that changes. */
	private legendFor: string | null = null;
	/** The decisions were dropped on purpose (Escape, then « Abandonner »): closing asks nothing. */
	private discarded = false;
	/** `run` on the next tick (or after `ms`), unless the view unloads first: the pickers' cancel, a brief message's end. Set on open, before any key. */
	private nextTick!: (run: () => void, ms?: number) => void;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: DeckViewDeps,
	) {
		super(leaf);
		this.images = new AppImages((path) => this.deps.fetchImage(path));
	}

	getViewType(): string {
		return DECK_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Trier";
	}

	getIcon(): string {
		return "layers";
	}

	async onOpen() {
		this.nextTick = tickUnlessUnloaded(this);
		this.contentEl.addClass("suivi-deck");
		// The kanban's type colours as `--type-color` on the Deck's `data-type` elements; outside `contentEl`, which each session empties.
		this.containerEl.createEl("style", { text: typeColorsCss([".suivi-deck "]) });
		this.contentEl.tabIndex = 0;
		this.registerDomEvent(this.contentEl, "keydown", (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			const key = deckKey(e);
			if (key === null || !this.state) return;
			if (key === "Escape") {
				e.preventDefault();
				return this.quit();
			}
			const step = press(this.state, key);
			if (step.state === this.state && step.effects.length === 0) return;
			e.preventDefault();
			this.apply(step);
		});
		await this.restart();
	}

	async onClose() {
		this.releaseRenderScope();
		this.images.clear();
		const state = this.state;
		// A commit under way finishes the session itself; a written one was finished.
		if (state?.phase === "committing" || state?.phase === "done") return;
		if (state && !this.discarded && this.unwritten() > 0) this.deps.closedWithDecisions(state);
		else this.deps.finish();
	}

	/** The decisions recorded and not written yet: none once the session writes. */
	unwritten(): number {
		return this.state?.phase === "deciding" ? decisionCount(this.state) : 0;
	}

	/** Escape: the Deck closes, after asking when decisions would be dropped. */
	private quit() {
		if (this.state?.phase === "committing") return;
		confirmDiscard(
			this.app,
			this.unwritten(),
			() => {
				this.discarded = true;
				this.leaf.detach();
			},
			() => this.contentEl.focus(),
		);
	}

	/** A new session from the app's Tickets À trier (or the one the plugin resumes). */
	async restart() {
		this.state = null;
		this.discarded = false;
		this.shownIndex = -1;
		this.shownScreen = null;
		this.contentEl.empty();
		this.contentEl.createEl("p", { text: "Chargement…", cls: "suivi-deck-loading" });
		try {
			this.state = await this.deps.load();
		} catch (e) {
			this.contentEl.empty();
			this.contentEl.createEl("p", messageLine({ kind: "error", text: `Tickets indisponibles : ${(e as Error).message}` })!);
			return;
		}
		this.layout();
		this.render();
	}

	/** Takes the session's next state and runs its effects. */
	private apply(step: DeckStep) {
		this.state = step.state;
		this.render();
		const message = step.state.message;
		if (message?.brief) this.nextTick(() => this.clearMessage(message), BRIEF_MESSAGE_MS);
		for (const effect of step.effects) void this.run(effect);
	}

	/** A brief message gone, unless another key replaced it meanwhile. */
	private clearMessage(message: DeckState["message"]) {
		if (!this.state || this.state.message !== message) return;
		this.state = { ...this.state, message: null };
		this.render();
	}

	/** A click on a reached dot of the progress strip: that card. */
	private go(index: number) {
		if (this.state) this.apply({ state: goTo(this.state, index), effects: [] });
		this.contentEl.focus();
	}

	private async run(effect: DeckEffect) {
		if (effect.kind === "commit") return this.commit(effect.cards);
		openEffectModal(this.modalHost, effect);
	}

	/** What the modals of the session's effects see of the view. */
	private readonly modalHost: DeckModalHost = {
		app: this.app,
		state: () => this.state,
		back: (next) => {
			if (next && this.state) this.apply({ state: next, effects: [] });
			this.contentEl.focus();
		},
		nextTick: (run) => this.nextTick(run),
	};

	/** The cards written in turn, each row showing its result, then the closing Push: the report. */
	private async commit(cards: Extract<DeckEffect, { kind: "commit" }>["cards"]) {
		await commitCards(cards, this.deps, (index, result) => {
			if (this.state) this.apply({ state: cardDone(this.state, index, result), effects: [] });
		});
		const pushed = await this.deps.push().then(pushReport, (e: unknown) => pushReport(e instanceof Error ? e : new Error(String(e))));
		if (this.state) this.apply({ state: commitDone(this.state, pushed), effects: [] });
		this.deps.finish();
	}

	/** The Sweep's lines read in their notes, for the focused row. */
	private async readSweepLines() {
		if (!this.state) return;
		const lines = await readSweepLines(this.app, this.state);
		if (this.state) this.apply({ state: withSweepLines(this.state, lines), effects: [] });
	}

	/** What a click on a list does. */
	private readonly listActions: ListActions = {
		focusRow: (index) => this.go(index),
		openNote: (path) => {
			void this.app.workspace.openLinkText(path, "", "split");
		},
		continueOn: () => {
			if (this.state?.phase === "deciding") this.apply({ state: moveTo(this.state, sweepCount(this.state)), effects: [] });
			this.contentEl.focus();
		},
		reopen: (row) => {
			if (this.state) this.apply(press({ ...this.state, endRow: row }, "Enter"));
			this.contentEl.focus();
		},
		writeAll: () => {
			if (this.state) this.apply(press({ ...this.state, endRow: null }, "Enter"));
			this.contentEl.focus();
		},
		close: () => this.leaf.detach(),
		retry: () => {
			if (this.state) this.apply(retryFailed(this.state));
		},
	};

	/** The progress strip, the two sides and the legend, drawn once per session. */
	private layout() {
		({ strip: this.strip, left: this.left, right: this.right, legend: this.legend } = drawLayout(this.contentEl, (i) => this.go(i)));
		this.legendFor = null;
	}

	/** The legend of the screen, redrawn when the screen or the phase changes (the Sweep's keep day is the session's). */
	private showLegend(state: DeckState, screen: DeckScreen) {
		const kind = `${screen}:${state.phase}`;
		if (!this.legend || kind === this.legendFor) return;
		this.legendFor = kind;
		drawLegend(this.legend, state);
	}

	private render() {
		const state = this.state;
		if (!state || !this.left || !this.right) return;
		const screen = deckScreen(state);
		const entered = screen !== this.shownScreen;
		this.shownScreen = screen;
		// The fields' side is the Ticket's only: the lists take the whole width (`styles.css`).
		this.contentEl.dataset.screen = screen;
		if (screen === "ticket") {
			if (state.index !== this.shownIndex) {
				this.shownIndex = state.index;
				this.drawTicket(this.left, state);
			}
			drawFields(this.right, state);
		} else {
			// The lists are redrawn on every change: a focus, a decision, a result as it is written.
			this.shownIndex = -1;
			this.releaseRenderScope();
			this.drawList(this.left, state, screen);
			this.right.empty();
		}
		if (this.strip) drawStrip(this.strip, state);
		this.showLegend(state, screen);
		if (screen === "sweep" && entered) void this.readSweepLines();
	}

	/** The Sweep list, the end screen (or report), « Rien à trier ». */
	private drawList(el: HTMLElement, state: DeckState, screen: Exclude<DeckScreen, "ticket">) {
		switch (screen) {
			case "empty":
				return drawNothing(el, () => this.leaf.detach());
			case "sweep":
				return drawSweepList(el, sweepList(state, localDay()), deckMessage(state), this.listActions);
			case "end": {
				drawEndScreen(el, endScreen(state), deckMessage(state), this.listActions);
				// The report's buttons take Enter: « Fermer » first.
				if (state.phase === "done") el.querySelector<HTMLButtonElement>(".suivi-deck-end-buttons .mod-cta")?.focus();
			}
		}
	}

	private drawTicket(el: HTMLElement, state: DeckState) {
		el.empty();
		this.releaseRenderScope();
		const item = currentItem(state);
		if (item?.kind !== "ticket") return;
		const side = ticketSide(item.ticket, this.deps.appUrl());
		drawTicketHead(el, side);
		const scope = (this.renderScope = this.addChild(new Component()));
		void MarkdownRenderer.render(this.app, side.description, el.createDiv({ cls: "suivi-deck-description" }), "", scope);
		if (side.images.length === 0) return;
		drawThumbnails(el.createDiv({ cls: "suivi-deck-images" }), side.images, scope, {
			localUrls: (paths) => this.images.urls(paths),
			open: (src, alt) => new ImageModal(this.app, src, alt, () => this.contentEl.focus()).open(),
		});
	}

	private releaseRenderScope() {
		if (this.renderScope) this.removeChild(this.renderScope);
		this.renderScope = null;
	}
}
