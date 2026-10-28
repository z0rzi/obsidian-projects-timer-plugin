// Minimal runtime stand-ins for the "obsidian" module, which ships types only.
export class TFile {}
export class TAbstractFile {}
export class Notice {}
export class Plugin {}
/** An element that takes any child and text, enough for modals to draw into. */
function stubEl(): Record<string, unknown> {
	const el: Record<string, unknown> = {};
	el.empty = () => {};
	el.setText = () => {};
	el.createEl = () => stubEl();
	el.createDiv = () => stubEl();
	return el;
}
export class Modal {
	titleEl = stubEl();
	contentEl = stubEl();
	scope = { register(): void {} };
	opened = false;
	constructor(public app?: unknown) {}
	open(): void {
		this.opened = true;
		(this as { onOpen?: () => void }).onOpen?.();
	}
	close(): void {
		this.opened = false;
	}
}
/** Like Obsidian's: `close()` runs `onClose`; a choice is handed over after closing, as `selectSuggestion` does. */
export abstract class FuzzySuggestModal<T> extends Modal {
	setPlaceholder(): void {}
	close(): void {
		super.close();
		(this as { onClose?: () => void }).onClose?.();
	}
	abstract getItems(): T[];
	abstract getItemText(item: T): string;
	abstract onChooseItem(item: T, evt?: unknown): void;
}
/**
 * Like Obsidian's View: `leaf.open(view)` calls the undocumented
 * `view.open(containerEl)`, which runs `onOpen`. A subclass member named
 * `open` would shadow it.
 */
export class ItemView {
	openedWith: unknown = null;
	constructor(public leaf?: unknown) {}
	async open(containerEl: unknown): Promise<void> {
		this.openedWith = containerEl;
	}
}
export class Component {
	load(): void {}
	unload(): void {}
}
export const MarkdownRenderer = { render: async (): Promise<void> => {} };
export function setIcon(): void {}
export class PluginSettingTab {}
export class ToggleComponent {
	value = false;
	private changed: (value: boolean) => void = () => {};
	getValue(): boolean {
		return this.value;
	}
	/** Like Obsidian's: a new value runs the change callback. */
	setValue(value: boolean): this {
		if (value !== this.value) {
			this.value = value;
			this.changed(value);
		}
		return this;
	}
	setTooltip(): this {
		return this;
	}
	onChange(callback: (value: boolean) => void): this {
		this.changed = callback;
		return this;
	}
}
export class ButtonComponent {
	click: () => void = () => {};
	setButtonText(): this {
		return this;
	}
	setCta(): this {
		return this;
	}
	onClick(callback: () => void): this {
		this.click = callback;
		return this;
	}
}
/** Every Setting drawn, newest last, for tests to find their toggles and buttons. */
export const settings: Setting[] = [];
export class Setting {
	name = "";
	toggle: ToggleComponent | null = null;
	button: ButtonComponent | null = null;
	constructor(_containerEl?: unknown) {
		settings.push(this);
	}
	setName(name: string): this {
		this.name = name;
		return this;
	}
	setDesc(): this {
		return this;
	}
	addToggle(build: (toggle: ToggleComponent) => void): this {
		this.toggle = new ToggleComponent();
		build(this.toggle);
		return this;
	}
	addButton(build: (button: ButtonComponent) => void): this {
		this.button = new ButtonComponent();
		build(this.button);
		return this;
	}
}
/** Obsidian's `normalizePath`, enough for test paths: slashes collapsed, none at the edges. */
export function normalizePath(path: string): string {
	return path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
/**
 * Obsidian's `moment`, `YYYY`, `MM` and `DD` only (local day): formats a date,
 * or parses `input` in `format` (strict: the whole string, a real day).
 */
export function moment(input: Date | string = new Date(), format?: string, _strict?: boolean) {
	const pad = (n: number) => String(n).padStart(2, "0");
	let date: Date | null = input instanceof Date ? input : null;
	if (typeof input === "string" && format) {
		const order: string[] = [];
		const source = format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/YYYY|MM|DD/g, (token) => {
			order.push(token);
			return token === "YYYY" ? "(\\d{4})" : "(\\d{2})";
		});
		const m = input.match(new RegExp(`^${source}$`));
		if (m) {
			const part = (token: string) => Number(m[order.indexOf(token) + 1]);
			const parsed = new Date(part("YYYY"), part("MM") - 1, part("DD"));
			if (parsed.getMonth() === part("MM") - 1 && parsed.getDate() === part("DD")) date = parsed;
		}
	}
	return {
		isValid: () => date !== null,
		format(out: string): string {
			if (!date) return "Invalid date";
			return out
				.replace("YYYY", String(date.getFullYear()))
				.replace("MM", pad(date.getMonth() + 1))
				.replace("DD", pad(date.getDate()));
		},
	};
}
