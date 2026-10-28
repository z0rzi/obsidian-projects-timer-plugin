import { Notice, type Plugin, type WorkspaceLeaf } from "obsidian";
import type { VaultProject } from "../inbox/inboxStore";
import type { TriageDeps } from "../inbox/triage";
import type { PushOutcome } from "../sync/runPush";
import type { Remote } from "../remote/remote";
import { confirmDiscard } from "../ui/DiscardModal";
import { DECK_VIEW_TYPE, DeckView } from "../views/DeckView";
import { archiveTicket, writeTicket } from "./deckRun";
import { loadSession } from "./deckLoad";
import { pushReport } from "./pushReport";
import { decisionCount, type DeckState } from "./deckSession";
import type { SweepDeps } from "./sweepDeps";
import { frigoTasks, keepTask, moveTask, type SweptLine } from "./sweepRun";

export interface DeckDeps {
	remote: Remote;
	/** How Triage writes into today's Daily note, read when a Ticket is written. */
	triage(): TriageDeps;
	/** The Project notes a Task may join at Triage, by title. */
	projects(): VaultProject[];
	/** Runs `task` alone among the plugin's writes to the app and the vault. */
	exclusive<T>(task: () => Promise<T>): Promise<T>;
	/** After a session (ended or closed): the Inbox reloads. */
	finished(): void;
	/** The Sweep's vault side, read when a session starts; null when it can't run (no projects location). */
	sweep(): SweepDeps | null;
	appUrl(): string;
}

/**
 * The Deck view and the command « Trier les tickets »; returns `openDeck`
 * (the Inbox's « Trier (n) »). A session is read when the Deck opens
 * (`deckLoad.ts`): the Sweep's candidates on the day's first session, then the
 * app's Tickets À trier. The session only records decisions; they
 * are written when it commits, then what the Sweep wrote into the vault is
 * pushed, its result on the Deck's report. Closing the Deck's tab with decisions not
 * written asks before dropping them; « Reprendre » opens the Deck again on
 * that session (kept in memory only).
 */
export function registerDeck(plugin: Plugin, deps: DeckDeps): () => void {
	const { app } = plugin;
	const { remote } = deps;

	/** The Sweep of the running session, and the lines it wrote, for the closing Push. */
	let sweep: SweepDeps | null = null;
	let swept: SweptLine[] = [];
	/** The session « Reprendre » opens the Deck on, read by `load` instead of a new one. */
	let resumed: DeckState | null = null;
	/** The plugin unloads: its Deck closing asks nothing. */
	let unloading = false;
	plugin.register(() => {
		unloading = true;
	});

	/** The closing Push of what the Sweep wrote since the last one; null when there was nothing. Throws when it can't run. */
	async function pushSwept(): Promise<PushOutcome | null> {
		const lines = swept;
		swept = [];
		if (lines.length === 0 || !sweep) return null;
		const run = sweep;
		return deps.exclusive(() => run.push(lines));
	}

	/** What the Sweep wrote and no report showed (a Deck closed while writing): pushed, its result as a notice. */
	async function pushLeftovers() {
		const report = await pushSwept().then(pushReport, (e: Error) => pushReport(e));
		if (report) new Notice(report.text, report.tone === "error" ? 10_000 : undefined);
	}

	async function load() {
		if (resumed) {
			const state = resumed;
			resumed = null;
			return state;
		}
		await pushLeftovers();
		sweep = deps.sweep();
		return loadSession({
			inbox: () => remote.inbox(),
			fullState: () => remote.fullState(),
			sweep,
			projects: deps.projects(),
			now: new Date(),
			notify: (message) => void new Notice(message),
		});
	}

	/** Runs a Sweep write alone among the plugin's writes, the lines it wrote kept for the closing Push. */
	function sweepWrite<T>(write: (run: SweepDeps) => Promise<T>, written: (result: T) => SweptLine[]): Promise<T> {
		const run = sweep!;
		return deps.exclusive(async () => {
			const result = await write(run);
			swept.push(...written(result));
			return result;
		});
	}

	/** The Deck's tab closed with `state`'s decisions not written: drop them, or open the Deck again on them. */
	function closedWithDecisions(state: DeckState) {
		if (unloading) return void finish();
		confirmDiscard(
			app,
			decisionCount(state),
			() => void finish(),
			() => void openDeck(state),
		);
	}

	async function finish() {
		await pushLeftovers();
		deps.finished();
	}

	plugin.registerView(
		DECK_VIEW_TYPE,
		(leaf: WorkspaceLeaf) =>
			new DeckView(leaf, {
				load,
				write: (ticket, choice) => deps.exclusive(() => writeTicket(ticket, choice, deps.triage())),
				archive: (ticket, comment) => deps.exclusive(() => archiveTicket(ticket, comment, remote)),
				frigo: (tasks) =>
					sweepWrite(
						(run) => frigoTasks(tasks, run.files),
						(result) => result.written,
					),
				move: (task, project) =>
					sweepWrite(
						(run) => moveTask(task, project, run.files, run.projectOf(task.path)),
						// A line not Pushed yet is now a step line of the Project note.
						(outcome) => (outcome.kind !== "swept" ? [] : [task.id ?? { path: project.path, raw: `- [ ] ${task.raw}` }]),
					),
				keep: (task, until) => deps.exclusive(() => keepTask(task, until, remote)),
				push: pushSwept,
				finish: () => void finish(),
				closedWithDecisions,
				notify: (message) => void new Notice(message, 10_000),
				appUrl: deps.appUrl,
				fetchImage: (path) => remote.image(path),
			}),
	);

	/**
	 * Opens the Deck in a tab of its own: a new session, or `resume`. A Deck already open is shown as it is when it
	 * holds decisions not written yet, else it starts a new session.
	 */
	async function openDeck(resume?: DeckState) {
		const existing = app.workspace.getLeavesOfType(DECK_VIEW_TYPE)[0];
		resumed = resume ?? null;
		if (existing?.view instanceof DeckView) {
			if (resume || existing.view.unwritten() === 0) await existing.view.restart();
			await app.workspace.revealLeaf(existing);
		} else {
			const leaf = existing ?? app.workspace.getLeaf("tab");
			await leaf.setViewState({ type: DECK_VIEW_TYPE, active: true });
			await app.workspace.revealLeaf(leaf);
		}
		const view = app.workspace.getLeavesOfType(DECK_VIEW_TYPE)[0]?.view;
		if (view instanceof DeckView) view.contentEl.focus();
	}

	plugin.addCommand({ id: "open-suivi-deck", name: "Trier les tickets", callback: () => void openDeck() });
	return () => void openDeck();
}
