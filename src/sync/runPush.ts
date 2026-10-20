import { RemoteError, type Remote } from "../remote/remote";
import type { SyncState } from "./pluginData";
import type { PendingChange } from "./pushPlan";

export interface PushDeps {
	remote: Remote;
	sync: SyncState;
	/** Persists `sync`. */
	save: () => Promise<void>;
	/** Writes `suivi_id: <id>` into the Project file's frontmatter. */
	writeSuiviId: (path: string, id: string) => Promise<void>;
}

export interface PushOutcome {
	applied: number;
	failed: { title: string; error: string }[];
}

/**
 * Sends the ticked changes in one batch and records each applied one as
 * last-pushed. Rejected and unticked changes stay pending. A failure of the
 * whole call (bad token, app down) throws a RemoteError and changes nothing.
 */
export async function runPush(selected: PendingChange[], deps: PushDeps): Promise<PushOutcome> {
	if (selected.length === 0) return { applied: 0, failed: [] };
	const results = await deps.remote.push(selected.map((c) => c.change));
	if (results.length !== selected.length) {
		throw new RemoteError("server", `Suivi answered ${results.length} results for ${selected.length} changes.`);
	}

	const outcome: PushOutcome = { applied: 0, failed: [] };
	const created: { path: string; id: string; title: string }[] = [];
	selected.forEach((change, i) => {
		const result = results[i]!;
		if (!result.ok) {
			outcome.failed.push({ title: change.title, error: result.error });
			return;
		}
		outcome.applied++;
		const pushed = deps.sync.pushedProjects;
		if (change.group === "deleted") delete pushed[change.id];
		else pushed[result.id] = { path: change.path, fields: change.fields };
		if (change.group === "new") created.push({ path: change.path, id: result.id, title: change.title });
	});
	// Save before touching files, so an id the app gave is never lost.
	await deps.save();

	for (const c of created) {
		try {
			await deps.writeSuiviId(c.path, c.id);
		} catch (e) {
			outcome.failed.push({
				title: c.title,
				error: `created in Suivi but suivi_id: ${c.id} could not be written (${(e as Error).message}); add it by hand`,
			});
		}
	}
	return outcome;
}
