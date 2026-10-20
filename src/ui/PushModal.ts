import { App, Modal, Setting } from "obsidian";
import type { PendingChange } from "../sync/pushPlan";

const GROUPS: { group: PendingChange["group"]; heading: string }[] = [
	{ group: "new", heading: "New" },
	{ group: "changed", heading: "Changed" },
	{ group: "deleted", heading: "Deleted (archived in Suivi)" },
	{ group: "conflict", heading: "Conflicts (changed in both)" },
];

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
 * Lists pending changes grouped new / changed (old → new) / deleted /
 * conflicts, all ticked; pushes the ticked ones. A conflict shows the vault
 * and Suivi values and the Developer picks which one wins (vault by default).
 */
export class PushModal extends Modal {
	private readonly ticked: Set<string>;

	constructor(
		app: App,
		private readonly changes: PendingChange[],
		private readonly onPush: (selected: PendingChange[]) => void,
	) {
		super(app);
		this.ticked = new Set(changes.map((c) => c.key));
	}

	onOpen() {
		const { contentEl } = this;
		this.setTitle("Push to Suivi");

		if (this.changes.length === 0) {
			contentEl.createEl("p", { text: "Nothing to push." });
			return;
		}

		for (const { group, heading } of GROUPS) {
			const items = this.changes.filter((c) => c.group === group);
			if (items.length === 0) continue;
			contentEl.createEl("h4", { text: heading });
			for (const change of items) {
				const isTask = change.change.kind === "task";
				const setting = new Setting(contentEl)
					.setName(
						isTask ? change.title : `${change.change.kind === "review" ? "Review" : "Project"}: ${change.title}`,
					)
					.addToggle((t) =>
						t.setValue(true).onChange((on) => {
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
						// Task and Review diffs come ready to show.
						const text = isTask || change.change.kind === "review"
							? `${d.field}: ${d.from} → ${d.to}`
							: `${d.field}: ${show(d.field, d.from)} → ${show(d.field, d.to)}`;
						desc.createDiv({ text });
					}
				}
			}
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

	onClose() {
		this.contentEl.empty();
	}
}
