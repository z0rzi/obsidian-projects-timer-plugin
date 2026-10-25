import { App, Modal, Setting } from "obsidian";
import type { Conflict } from "../sync/compareState";
import type { PendingConflict } from "../sync/conflicts";
import type { PendingChange } from "../sync/pushPlan";
import { conflictButtons } from "../views/inboxPinned";

const GROUPS: { group: PendingChange["group"]; heading: string }[] = [
	{ group: "new", heading: "New" },
	{ group: "restored", heading: "Restaurer (archived in Suivi)" },
	{ group: "changed", heading: "Changed" },
	{ group: "conflict", heading: "Conflicts (changed in both)" },
	{ group: "error", heading: "Not pushed (fix in the note)" },
];

/** Never-pushed done lines without a date, listed apart in a collapsed group. */
const isUndated = (c: PendingChange) => c.group === "new" && "undated" in c && c.undated === true;

/**
 * Lists pending changes grouped new / restored / changed (old → new) /
 * conflicts / errors under the app's host, ticked unless they say otherwise;
 * pushes the ticked ones. « Terminées sans date » is a collapsed group of its
 * own. A conflict has a button per value, which settles it at once
 * (`pick`), not with the Push. Error lines can't be ticked.
 */
export class PushModal extends Modal {
	private readonly ticked: Set<string>;

	constructor(
		app: App,
		private readonly host: string,
		private readonly changes: PendingChange[],
		private readonly pick: (conflict: Conflict, choice: "mine" | "theirs") => Promise<boolean>,
		private readonly onPush: (selected: PendingChange[]) => void,
	) {
		super(app);
		this.ticked = new Set(
			changes
				.filter((c) => c.group !== "error" && c.group !== "conflict" && !("ticked" in c && c.ticked === false))
				.map((c) => c.key),
		);
	}

	onOpen() {
		const { contentEl } = this;
		this.setTitle(`Push to Suivi · ${this.host}`);

		if (this.changes.length === 0) {
			contentEl.createEl("p", { text: "Nothing to push." });
			return;
		}

		for (const { group, heading } of GROUPS) {
			const items = this.changes.filter((c) => c.group === group && !isUndated(c));
			if (items.length === 0) continue;
			contentEl.createEl("h4", { text: heading });
			for (const change of items) this.renderChange(contentEl, change);
		}
		const undated = this.changes.filter(isUndated);
		if (undated.length > 0) {
			const details = contentEl.createEl("details");
			details.createEl("summary", { text: `Terminées sans date (${undated.length})` });
			for (const change of undated) this.renderChange(details, change);
		}

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Push")
					.setCta()
					.onClick(() => {
						const selected = this.changes.filter((c) => this.ticked.has(c.key));
						this.close();
						this.onPush(selected);
					}),
			);
	}

	/** One line: its switch (none for an error, buttons for a conflict), then what it changes. */
	private renderChange(parent: HTMLElement, change: PendingChange) {
		if (change.group === "error") {
			new Setting(parent).setName(change.title).setDesc(`${change.path}: ${change.error}`);
			return;
		}
		if (change.group === "conflict") {
			this.renderConflict(parent, change);
			return;
		}
		const isTask = change.change.kind === "task";
		const setting = new Setting(parent)
			.setName(isTask ? change.title : `Project: ${change.title}`)
			.addToggle((t) =>
				t.setValue(this.ticked.has(change.key)).onChange((on) => {
					if (on) this.ticked.add(change.key);
					else this.ticked.delete(change.key);
				}),
			);
		const desc = setting.descEl;
		if ("detail" in change) desc.createDiv({ text: change.detail });
		if (change.group === "changed") {
			for (const d of change.diffs) desc.createDiv({ text: `${d.field}: ${d.from} → ${d.to}` });
		}
	}

	/** A conflict: what changed on both sides, and a button per value; once settled, the line says so. */
	private renderConflict(parent: HTMLElement, entry: PendingConflict) {
		const { conflict } = entry;
		const what = conflict.unit === "priority" ? "Priorité" : "Réponse du Client";
		const setting = new Setting(parent).setName(conflict.kind === "task" ? entry.title : `Project: ${entry.title}`).setDesc(what);
		for (const { choice, text } of conflictButtons(conflict)) {
			setting.addButton((b) =>
				b.setButtonText(text).onClick(async () => {
					setting.setDisabled(true);
					if (await this.pick(conflict, choice)) {
						setting.clear();
						setting.setDesc(`${what} : ${text}, réglé`);
					} else setting.setDisabled(false);
				}),
			);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
