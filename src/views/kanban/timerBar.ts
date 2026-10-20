import { Notice, setIcon, type App, type TFile } from "obsidian";
import { AddActivityModal } from "../../ui/AddActivityModal";

/** What a timer runs for: a Task card or a Project card. */
export interface TimerSubject {
	title: string;
	projectFile?: TFile;
}

export interface TimerDeps {
	app: App;
	/** Logs the time in the Project's ```project block. */
	addActivity(projectFile: TFile, durationMins: number, description: string): void;
	parseTime(raw: string): number;
	/** Shows or hides the cards' play buttons. */
	showPlayButtons(show: boolean): void;
}

const TEN_MINUTES = 10 * 60 * 1000;

/**
 * The kanban footer timer: elapsed time with -10/+10 min, and pause, which
 * offers to log the time (rounded to 10 min, at least 10) on the Project.
 */
export class TimerBar {
	private subject: TimerSubject | null = null;
	private startedAt: Date | null = null;
	private interval: number | null = null;

	constructor(
		private readonly footerEl: HTMLElement,
		private readonly deps: TimerDeps,
	) {}

	start(subject: TimerSubject): void {
		this.stop();
		this.subject = subject;
		this.startedAt = new Date();
		this.deps.showPlayButtons(false);
		this.render();
	}

	stop(): void {
		if (this.interval !== null) window.clearInterval(this.interval);
		this.interval = null;
		const wasRunning = this.subject !== null;
		this.subject = null;
		this.startedAt = null;
		this.footerEl.empty();
		if (wasRunning) this.deps.showPlayButtons(true);
	}

	private render(): void {
		this.footerEl.empty();
		const subject = this.subject;
		if (!subject) return;

		const bar = this.footerEl.createDiv("kanban-timer-bar");
		Object.assign(bar.style, {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			padding: "12px",
			paddingBottom: "0px",
			width: "100%",
			boxSizing: "border-box",
			borderTop: "1px solid var(--background-modifier-border)",
		});

		const titleEl = bar.createSpan();
		titleEl.textContent = subject.title;
		Object.assign(titleEl.style, { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });

		this.button(bar, "minus", () => {
			if (!this.startedAt) return;
			const later = new Date(this.startedAt.getTime() + TEN_MINUTES);
			this.startedAt = later > new Date() ? new Date() : later;
		});
		const timeEl = bar.createSpan("kanban-timer-time");
		Object.assign(timeEl.style, {
			fontVariantNumeric: "tabular-nums",
			minWidth: "60px",
			textAlign: "center",
			color: "var(--text-faint)",
		});
		this.button(bar, "plus", () => {
			if (this.startedAt) this.startedAt = new Date(this.startedAt.getTime() - TEN_MINUTES);
		});
		const pause = this.button(bar, "pause", () => this.pause(subject));
		Object.assign(pause.style, {
			color: "#f56565",
			backgroundColor: "#f5656522",
			padding: "5px",
			paddingBottom: "1px",
			borderRadius: "50%",
		});

		const tick = () => {
			if (!this.startedAt) return;
			const total = Math.max(0, Math.floor((Date.now() - this.startedAt.getTime()) / 1000));
			const pad = (n: number) => String(n).padStart(2, "0");
			const hours = Math.floor(total / 3600);
			timeEl.setText(`${hours > 0 ? pad(hours) + ":" : ""}${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`);
		};
		this.tick = tick;
		tick();
		this.interval = window.setInterval(tick, 1000);
	}

	private tick: () => void = () => {};

	private button(bar: HTMLElement, icon: string, onClick: () => void): HTMLElement {
		const el = bar.createSpan("kanban-timer-btn");
		setIcon(el, icon);
		el.style.cursor = "pointer";
		el.addEventListener("click", () => {
			onClick();
			this.tick();
		});
		return el;
	}

	private pause(subject: TimerSubject): void {
		if (!this.startedAt) return;
		const elapsedMins = Math.max(1, Math.round((Date.now() - this.startedAt.getTime()) / 60000));
		this.stop();
		if (elapsedMins < 10) {
			new Notice("Time too short to record");
			return;
		}
		new AddActivityModal(
			this.deps.app,
			(duration, description, projectFile) => this.deps.addActivity(projectFile, duration, description),
			(raw) => this.deps.parseTime(raw),
			Math.round(elapsedMins / 10) * 10,
			subject.projectFile,
		).open();
	}
}
