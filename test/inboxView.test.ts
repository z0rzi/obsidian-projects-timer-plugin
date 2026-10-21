import { describe, expect, it, vi } from "vitest";
import { ItemView } from "obsidian";
import { InboxView } from "../src/views/InboxView";
import type { InboxStore } from "../src/inbox/inboxStore";

describe("InboxView", () => {
	it("keeps Obsidian's View.open, so opening the leaf does not run the entry-click callback", async () => {
		const openItem = vi.fn();
		const view = new InboxView(
			{} as never,
			{} as InboxStore,
			() => () => {},
			openItem,
			() => "",
			async () => null as never,
		);
		expect(Object.prototype.hasOwnProperty.call(view, "open")).toBe(false);
		expect(view.open).toBe(ItemView.prototype.open);

		const containerEl = {};
		await view.open(containerEl as never);
		expect(openItem).not.toHaveBeenCalled();
	});
});
