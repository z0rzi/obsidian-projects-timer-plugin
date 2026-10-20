import type { LineRef } from "../lineWriter";
import type { PushChange, PushResult } from "../remote/api";
import { RemoteError, type Remote } from "../remote/remote";
import type { SyncState } from "./pluginData";
import type { PendingChange, PendingProjectChange } from "./pushPlan";
import type { PendingTaskChange } from "./taskPlan";

export interface PushDeps {
	remote: Remote;
	sync: SyncState;
	/** Persists `sync`. */
	save: () => Promise<void>;
	/** Writes `suivi_id: <id>` into the Project file's frontmatter. */
	writeSuiviId: (path: string, id: string) => Promise<void>;
	/** Ends the Task line with ` ^<id>`. */
	writeBlockId: (path: string, ref: Omit<LineRef, "blockId">, id: string) => Promise<void>;
	/** Keys of the undated done lines this plan left out; remembered after the first Push. */
	doneHistory?: string[];
}

export interface PushOutcome {
	applied: number;
	failed: { title: string; error: string }[];
}

/**
 * Sends the ticked changes and records each applied one as last-pushed.
 * Projects go first, so Tasks of a Project created in the same Push get its
 * id. Rejected and unticked changes stay pending. A failure of a whole call
 * (bad token, app down) throws a RemoteError; what was applied before is kept.
 */
export async function runPush(selected: PendingChange[], deps: PushDeps): Promise<PushOutcome> {
	const outcome: PushOutcome = { applied: 0, failed: [] };
	const projects = selected.filter((c): c is PendingProjectChange => c.change.kind === "project");
	const tasks = selected.filter((c): c is PendingTaskChange => c.change.kind === "task");

	const created = await pushProjects(projects, deps, outcome);

	const ready: PendingTaskChange[] = [];
	for (const t of tasks) {
		if (t.group === "deleted" || !t.needsProject) {
			ready.push(t);
			continue;
		}
		const projectId = created.get(t.needsProject) ?? findPushedProject(deps.sync, t.needsProject);
		if (!projectId) {
			const error = `its Project ${basename(t.needsProject)} is not in Suivi yet; push it too`;
			outcome.failed.push({ title: t.title, error });
			continue;
		}
		ready.push(withProject(t, projectId));
	}
	await pushTasks(ready, deps, outcome);
	return outcome;
}

function withProject(t: Exclude<PendingTaskChange, { group: "deleted" }>, projectId: string): PendingTaskChange {
	const fields = { ...t.fields, project_id: projectId };
	if (t.group === "new") return { ...t, fields, change: { ...t.change, fields } };
	return { ...t, fields, change: { ...t.change, fields: { ...t.change.fields, project_id: projectId } } };
}

async function send(remote: Remote, changes: PushChange[]): Promise<PushResult[]> {
	if (changes.length === 0) return [];
	const results = await remote.push(changes);
	if (results.length !== changes.length) {
		throw new RemoteError("server", `Suivi answered ${results.length} results for ${changes.length} changes.`);
	}
	return results;
}

/** Pushes Project changes; returns the ids of the created ones by path. */
async function pushProjects(selected: PendingProjectChange[], deps: PushDeps, outcome: PushOutcome) {
	const created = new Map<string, string>();
	const results = await send(deps.remote, selected.map((c) => c.change));
	if (results.length === 0) return created;
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
		if (change.group === "new") created.set(change.path, result.id);
	});
	// Save before touching files, so an id the app gave is never lost.
	await deps.save();
	for (const [path, id] of created) {
		try {
			await deps.writeSuiviId(path, id);
		} catch (e) {
			outcome.failed.push({
				title: basename(path),
				error: `created in Suivi but suivi_id: ${id} could not be written (${(e as Error).message}); add it by hand`,
			});
		}
	}
	return created;
}

async function pushTasks(selected: PendingTaskChange[], deps: PushDeps, outcome: PushOutcome) {
	const results = await send(deps.remote, selected.map((c) => c.change));
	if (results.length === 0) return;
	const created: { change: PendingTaskChange & { group: "new" }; id: string }[] = [];
	let applied = 0;
	selected.forEach((change, i) => {
		const result = results[i]!;
		if (!result.ok) {
			outcome.failed.push({ title: change.title, error: result.error });
			return;
		}
		applied++;
		const pushed = deps.sync.pushedTasks;
		if (change.group === "deleted") delete pushed[change.id];
		else pushed[result.id] = { path: change.path, fields: change.fields };
		if (change.group === "new") created.push({ change, id: result.id });
	});
	outcome.applied += applied;
	if (applied > 0 && !deps.sync.doneHistory) deps.sync.doneHistory = deps.doneHistory ?? [];
	await deps.save();
	for (const { change, id } of created) {
		try {
			await deps.writeBlockId(change.path, change.ref, id);
		} catch (e) {
			outcome.failed.push({
				title: change.title,
				error: `created in Suivi but ^${id} could not be written (${(e as Error).message}); add it at the end of the line by hand`,
			});
		}
	}
}

/** Id of a Project pushed earlier from `path` (its suivi_id may not be in the file cache yet). */
function findPushedProject(sync: SyncState, path: string): string | undefined {
	return Object.entries(sync.pushedProjects).find(([, p]) => p.path === path)?.[0];
}

function basename(path: string): string {
	const file = path.slice(path.lastIndexOf("/") + 1);
	return file.endsWith(".md") ? file.slice(0, -3) : file;
}
