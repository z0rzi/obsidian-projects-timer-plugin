import { type App, Modal, Setting } from "obsidian";
import type { TicketUrgency } from "../remote/api";
import { contextText, insertIntoText, type TicketContext } from "../inbox/inboxStore";
import { defaultPriority, defaultTag, TRIAGE_TAGS, URGENCIES, type TriageChoice } from "../inbox/triage";

const PRIORITIES = [0, 1, 2, 3, 4, 5] as const;

const INHERIT = "inherit";

/**
 * "Insérer ici" dialog: pick the tag and priority of the Task line written at the cursor
 * (« Insérer dans <projectTitle> »: as the first step of that Project);
 * a Project step can also inherit its Project's priority. Shows the Client's Project and
 * Urgency, whose suggested priority comes first (else p3, or inherit for a step).
 */
export class TriageModal extends Modal {
	private choice: TriageChoice;

	constructor(
		app: App,
		private readonly item: { title: string; type: string; step: boolean; context?: TicketContext; projectTitle?: string; urgency?: TicketUrgency | null },
		private readonly onSubmit: (choice: TriageChoice) => void,
	) {
		super(app);
		this.choice = { type: defaultTag(item.type), priority: defaultPriority(item.step, item.urgency) };
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText(`${this.action()} : ${this.item.title}`);
		if (this.item.context) contentEl.createDiv({ text: contextText(this.item.context), cls: "setting-item-description" });
		new Setting(contentEl).setName("Type").addDropdown((d) => {
			for (const t of TRIAGE_TAGS) d.addOption(t.type, t.label);
			d.setValue(this.choice.type).onChange((v) => (this.choice.type = v as TriageChoice["type"]));
		});
		const priority = new Setting(contentEl).setName("Priority");
		if (this.item.urgency) priority.setDesc(`Suggéré par l'urgence : ${URGENCIES[this.item.urgency].label}`);
		priority.addDropdown((d) => {
			if (this.item.step) d.addOption(INHERIT, "hériter du projet");
			for (const p of PRIORITIES) d.addOption(String(p), p === 0 ? "p0 (doing now)" : `p${p}`);
			d.setValue(String(this.choice.priority ?? INHERIT)).onChange(
				(v) => (this.choice.priority = PRIORITIES.find((p) => String(p) === v) ?? null),
			);
		});
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(this.action())
				.setCta()
				.onClick(() => this.submit()),
		);
		this.scope.register([], "Enter", (e) => {
			e.preventDefault();
			this.submit();
		});
	}

	/** « Insérer ici », or « Insérer dans <Projet> ». */
	private action(): string {
		return this.item.projectTitle ? insertIntoText(this.item.projectTitle) : "Insérer ici";
	}

	private submit() {
		this.close();
		this.onSubmit(this.choice);
	}

	onClose() {
		this.contentEl.empty();
	}
}
