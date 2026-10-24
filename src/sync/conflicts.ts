import type { Remote } from "../remote/remote";
import { acknowledgements, type Conflict } from "./compareState";
import type { PendingChange } from "./pushPlan";
import { writePull, type VaultFiles } from "./runPull";

/** A conflict in the Push review: its buttons act at once (`pickConflict`), it is never part of the Push. */
export interface PendingConflict {
	group: "conflict";
	key: string;
	path: string;
	title: string;
	conflict: Conflict;
}

/** Task diffs show `done` for `done_on`, `project` for `project_id`. */
const DIFF_FIELD: Record<string, string> = { done: "done_on", project: "project_id" };

/**
 * Takes the fields in conflict out of the plain "changed" entries, so they
 * are never pushed without the Developer picking (the base sent keeps them
 * at their base value), and lists the conflicts after them.
 */
export function withConflicts(pending: PendingChange[], conflicts: Conflict[]): PendingChange[] {
	if (conflicts.length === 0) return pending;
	/** The fields held out of plain changes, and the base they keep, by item id. */
	const held = new Map<string, { fields: Set<string>; base: Record<string, unknown> }>();
	for (const c of conflicts) {
		const now = held.get(c.id);
		const base = c.theirs.pull.base.fields as Record<string, unknown>;
		held.set(c.id, { fields: new Set([...(now?.fields ?? []), ...c.held]), base });
	}

	type Loose = Record<string, unknown>;
	const kept = pending.flatMap((p): PendingChange[] => {
		const hold = p.group === "changed" ? held.get(p.id) : undefined;
		if (p.group !== "changed" || !hold) return [p];
		const sent = { ...((p.change as { fields?: Loose }).fields ?? {}) };
		const expected = { ...((p.change as { expected?: Loose }).expected ?? {}) };
		const snapshot = { ...(p.fields as unknown as Loose) };
		for (const f of hold.fields) {
			delete sent[f];
			delete expected[f];
			if (f in hold.base) snapshot[f] = hold.base[f];
			else delete snapshot[f];
		}
		const diffs = p.diffs.filter((d) => !hold.fields.has(DIFF_FIELD[d.field] ?? d.field));
		if (diffs.length === 0) return [];
		return [{ ...p, fields: snapshot, diffs, change: { ...p.change, fields: sent, expected } } as unknown as PendingChange];
	});
	const entries: PendingConflict[] = conflicts
		.map((c) => ({ group: "conflict" as const, key: `conflict:${c.key}`, path: c.path, title: c.title, conflict: c }))
		.sort((a, b) => a.title.localeCompare(b.title));
	return [...kept, ...entries];
}

/**
 * Settles a conflict now, either way leaving the base at the chosen value.
 * "mine": pushes the vault's value with the app value it expects (refused if
 * the app moved again). "theirs": writes the app's value into the vault, then
 * acknowledges it. Throws with the reason on failure.
 */
export async function pickConflict(
	conflict: Conflict,
	choice: "mine" | "theirs",
	deps: { remote: Remote; files: VaultFiles },
): Promise<void> {
	if (choice === "mine") {
		const [result] = await deps.remote.push([conflict.mine.change]);
		if (!result?.ok) throw new Error(result?.error ?? "no answer from Suivi");
		return;
	}
	await writePull(deps.files, conflict.theirs.pull);
	await deps.remote.acknowledge(acknowledgements([conflict.theirs.pull]));
}
