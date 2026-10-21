// Minimal runtime stand-ins for the "obsidian" module, which ships types only.
export class TFile {}
export class TAbstractFile {}
export class Notice {}
export class Plugin {}
export class Modal {}
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
export class Setting {}
