import { App, Modal, Setting } from "obsidian";
import type { PendingChange } from "../sync/pushPlan";

const GROUPS: { group: PendingChange["group"]; heading: string }[] = [
	{ group: "new", heading: "New" },
	{ group: "restored", heading: "Restaurer (archived in Suivi)" },
	{ group: "changed", heading: "Changed" },
	{ group: "conflict", heading: "Conflicts (changed in both)" },
	{ group: "error", heading: "Not pushed (fix in the note)" },
];

/** Never-pushed done lines without a date, listed apart in a collapsed group. */
const isUndated = (c: PendingChange) => c.group === "new" && "undated" in c && c.undated === true;

const STATUS_LABELS: Record<string, string> = {
	a_faire: "À faire",
	en_cours: "En cours",
	en_pause: "En pause",
	a_valider: "À valider",
	termine: "Terminé",
};

function show(field: string, value: string | number | null): string {
	if (value === null) return "?";
	if (field === "status") return STATUS_LABELS[value] ?? String(value);
	if (field === "priority") return `P${value}`;
	if (field === "description") {
		const s = String(value).replace(/\s+/g, " ").trim();
		return s ? `“${s.length > 60 ? `${s.slice(0, 60)}…` : s}”` : "(empty)";
	}
	return String(value);
}

/**
 * Lists pending changes grouped new / restored / changed (old → new) /
 * conflicts / errors under the app's host, ticked unless they say otherwise;
 * pushes the ticked ones. « Terminées sans date » is a collapsed group of its
 * own. A conflict shows the vault and Suivi values and the Developer picks
 * which one wins (vault by default). Error lines can't be ticked.
 */
export class PushModal extends Modal {
	private readonly ticked: Set<string>;

	constructor(
		app: App,
		private readonly host: string,
		private readonly changes: PendingChange[],
		private readonly onPush: (selected: PendingChange[]) => void,
	) {
		super(app);
		this.ticked = new Set(
			changes.filter((c) => c.group !== "error" && !("ticked" in c && c.ticked === false)).map((c) => c.key),
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

	/** One line: its switch (none for an error), then what it changes. */
	private renderChange(parent: HTMLElement, change: PendingChange) {
		if (change.group === "error") {
			new Setting(parent).setName(change.title).setDesc(`${change.path}: ${change.error}`);
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
		if (change.group === "conflict") {
			desc.createDiv({ text: `${change.field}: vault ${change.local} · Suivi ${change.remote}` });
			setting.addDropdown((d) =>
				d
					.addOption("mine", `Keep vault (${change.local})`)
					.addOption("theirs", `Take Suivi (${change.remote})`)
					.setValue(change.choice)
					.onChange((v) => {
						change.choice = v === "theirs" ? "theirs" : "mine";
					}),
			);
		}
		if ("detail" in change) desc.createDiv({ text: change.detail });
		if (change.group === "changed") {
			for (const d of change.diffs) {
				// Task diffs come ready to show.
				const text = isTask
					? `${d.field}: ${d.from} → ${d.to}`
					: `${d.field}: ${show(d.field, d.from)} → ${show(d.field, d.to)}`;
				desc.createDiv({ text });
			}
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
