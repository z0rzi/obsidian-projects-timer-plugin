import { type App, type FuzzyMatch, FuzzySuggestModal } from "obsidian";

/**
 * The Deck's fuzzy pickers (`p` a Project note, `o` a Zone): `onPick` with the
 * item chosen, `onCancel` when closed without one (Escape). Obsidian closes the
 * modal before handing over the choice, so the cancel waits a tick:
 * `nextTick`, the owner's, which clears it when the owner unloads (a modal has
 * no `register*` helpers of its own). `detail`: shown faded after an item's
 * text (a Zone's path), not searched.
 */
export class DeckPicker<T> extends FuzzySuggestModal<T> {
	private chosen = false;

	constructor(
		app: App,
		private readonly items: T[],
		private readonly text: (item: T) => string,
		placeholder: string,
		private readonly onPick: (item: T) => void,
		private readonly onCancel: () => void,
		private readonly nextTick: (run: () => void) => void,
		private readonly detail: (item: T) => string | null = () => null,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): T[] {
		return this.items;
	}

	getItemText(item: T): string {
		return this.text(item);
	}

	renderSuggestion(match: FuzzyMatch<T>, el: HTMLElement): void {
		super.renderSuggestion(match, el);
		const detail = this.detail(match.item);
		if (detail) el.createSpan({ text: ` ${detail}`, cls: "suivi-deck-picker-detail" });
	}

	onChooseItem(item: T): void {
		this.chosen = true;
		this.onPick(item);
	}

	onClose(): void {
		this.nextTick(() => {
			if (!this.chosen) this.onCancel();
		});
	}
}
