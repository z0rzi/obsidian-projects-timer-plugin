import { appendToSection } from "../noteSections";
import { processLine, setTaskPriority } from "../lineWriter";
import { findTasksHeadingSection } from "../projectCards";
import type { Remote } from "../remote/remote";
import type { ProjectOfLink } from "../sync/projectLink";
import type { PendingChange } from "../sync/pushPlan";
import type { PushOutcome } from "../sync/runPush";
import type { VaultFiles } from "../sync/runPull";
import { indentedBodyEnd } from "../taskParser";
import type { DeckOutcome } from "./deckSession";
import { SWEEP_ERRORS, sweepLineIndex, type SweepCandidate } from "./sweep";

/**
 * The Sweep's writes, run by the Deck's commit for the cards decided: `pz` on
 * lines (`z`), a move into a Project note (`m`), a keep (Enter), and the
 * Push that closes the session with what the Sweep wrote.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A line the Sweep wrote, for the closing Push: its app id, or for a line not Pushed yet where it is now (its
 * note and its text), which the Push's `new` change of that line names.
 */
export type SweptLine = string | { path: string; raw: string };

/** `pz` on the line of `task`; returns what the closing Push sends of it. Throws when the line is not found. */
async function frigoLine(files: Pick<VaultFiles, "process">, task: SweepCandidate): Promise<SweptLine> {
	let raw = "";
	const result = await processLine(files.process, task.path, (content) => {
		const lines = content.split("\n");
		const at = sweepLineIndex(lines, task);
		if (at < 0) return { ok: false, reason: "not-found" };
		const done = setTaskPriority(content, { line: at, raw: lines[at]! }, "pz");
		if (done.ok) raw = done.content.split("\n")[at]!;
		return done;
	});
	if (!result.ok) throw new Error(result.reason === "not-found" ? SWEEP_ERRORS.missing : SWEEP_ERRORS.changed);
	return task.id ?? { path: task.path, raw };
}

/**
 * `z`: `pz` written on each line (`setTaskPriority`), the others
 * written when one fails. `written`: the lines the closing Push sends; the
 * outcome fails only when no line was written.
 */
export async function frigoTasks(
	tasks: SweepCandidate[],
	files: Pick<VaultFiles, "process">,
): Promise<{ outcome: DeckOutcome; written: SweptLine[]; errors: string[] }> {
	const written: SweptLine[] = [];
	const errors: string[] = [];
	for (const task of tasks) {
		try {
			written.push(await frigoLine(files, task));
		} catch (e) {
			errors.push(message(e));
		}
	}
	const outcome: DeckOutcome =
		written.length === 0 && tasks.length > 0
			? { kind: "failed", error: errors.join(" ; ") }
			: { kind: "swept", how: "frigo", passed: tasks.length, done: written.length };
	return { outcome, written, errors };
}

const BARE_LINK = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/;

/**
 * `m`: the Tag task's line and body moved to the end of the Tasks section of
 * the Project note `project` (a `## Tasks` heading added when it has none),
 * as a step: `- [ ] ` before the line, its type, token and `^id` kept (a
 * `#quick` without token then inherits). A first body line that is a bare
 * link to a Project note is dropped: the step's Project is its note. The
 * Project note is written first, then the line leaves its note; the closing
 * Push sends the new Project and step.
 */
export async function moveTask(
	task: SweepCandidate,
	project: { path: string },
	files: Pick<VaultFiles, "read" | "process">,
	projectOf: ProjectOfLink = () => null,
): Promise<DeckOutcome> {
	const gone: DeckOutcome = { kind: "failed", error: SWEEP_ERRORS.missing };
	try {
		const lines = (await files.read(task.path))?.split("\n") ?? [];
		const at = sweepLineIndex(lines, task);
		if (at < 0) return gone;
		const body = lines.slice(at + 1, indentedBodyEnd(lines, at) + 1);
		const first = body.findIndex((l) => l.trim() !== "");
		const link = first < 0 ? null : body[first]!.trim().match(BARE_LINK);
		if (link && projectOf(link[1]!) !== null) body.splice(0, first + 1);
		const text = [`- [ ] ${lines[at]!}`, ...body].join("\n");
		await files.process(project.path, (content) => {
			const noteLines = content.split("\n");
			const section = findTasksHeadingSection(noteLines);
			return appendToSection(content, section ? noteLines[section.start - 1]! : "## Tasks", text);
		});
		let removed = false;
		await files.process(task.path, (content) => {
			const now = content.split("\n");
			const line = sweepLineIndex(now, task);
			if (line < 0) return content;
			removed = true;
			now.splice(line, indentedBodyEnd(now, line) - line + 1);
			return now.join("\n");
		});
		if (!removed) return { kind: "failed", error: `copiée dans ${project.path}, mais ${SWEEP_ERRORS.missing}` };
		return { kind: "swept", how: "moved", passed: 1, done: 1 };
	} catch (e) {
		return { kind: "failed", error: message(e) };
	}
}

/** Enter: the Task kept in the app until `until` (`kept_until`); the vault is not written. A line not Pushed yet fails. */
export async function keepTask(task: SweepCandidate, until: string, remote: Pick<Remote, "keep">): Promise<DeckOutcome> {
	if (task.id === null) return { kind: "failed", error: SWEEP_ERRORS.notPushed };
	try {
		await remote.keep(task.id, until);
		return { kind: "swept", how: "kept", passed: 1, done: 1 };
	} catch (e) {
		return { kind: "failed", error: message(e) };
	}
}

/**
 * The Push closing a session: the Push's own plan, only the changes of the
 * lines the Sweep wrote (`lines`: by id, or a line not Pushed yet by its note
 * and text, which the Push creates), sent without the review, so the Client's
 * Nouveautés do not wait for a manual Push. Null, and no call, when there is
 * nothing of the Sweep's to send.
 */
export async function pushSwept(
	lines: Iterable<SweptLine>,
	deps: { plan(): Promise<PendingChange[]>; push(selected: PendingChange[]): Promise<PushOutcome> },
): Promise<PushOutcome | null> {
	const all = [...lines];
	if (all.length === 0) return null;
	const ids = new Set(all.filter((l) => typeof l === "string"));
	const fresh = all.filter((l) => typeof l !== "string");
	const selected = (await deps.plan()).filter((c) => {
		if (c.group !== "new" && c.group !== "changed" && c.group !== "restored") return false;
		if (c.id !== undefined) return ids.has(c.id);
		return c.group === "new" && "ref" in c && fresh.some((l) => l.path === c.path && l.raw === c.ref.raw);
	});
	return selected.length === 0 ? null : deps.push(selected);
}
