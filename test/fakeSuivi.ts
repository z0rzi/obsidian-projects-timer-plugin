// In-memory stand-ins for the Client app (`Remote`) and the vault (`VaultFiles`), for Push tests.
import type { AcknowledgedItem, ItemBase, ItemState, ProjectFields, PushChange, PushResult, StateAnswer, TaskStateFields, TriageRequest, TriageResponse } from "../src/remote/api";
import type { Remote } from "../src/remote/remote";
import { appItems, fetchAppItems, type AppItems } from "../src/sync/appState";
import type { Conflict } from "../src/sync/compareState";
import { pickConflict } from "../src/sync/conflicts";
import { planPush, readVaultItems, type Note } from "../src/sync/planPush";
import type { PendingChange } from "../src/sync/pushPlan";
import { runPush, vaultWriters } from "../src/sync/runPush";
import { shareBody } from "../src/sync/sharedBody";
import { runPull, type VaultFiles } from "../src/sync/runPull";

type Held = {
	kind: "project" | "task";
	fields: Record<string, unknown>;
	base: ItemBase | null;
	archived: boolean;
	triaged: boolean;
	answer: StateAnswer | null;
	priority_by: string | null;
	due_date_by?: string | null;
};

/**
 * An app holding `items` that applies Pushes as `src/items/push.ts` does: a
 * create keeps the id sent (a retried one with the same fields is ok), a
 * change whose `expected` no longer holds is refused, `base` is stored, a
 * change of the status drops the Answer. Acknowledges store the base and clear
 * the Answer they name. Uploads are deduplicated by content.
 */
export function fakeSuivi(items: ItemState[] = [], refuse: (c: PushChange) => string | undefined = () => undefined) {
	const held = new Map<string, Held>(
		items.map((i) => [
			i.id,
			{ kind: i.kind, fields: { ...i.fields }, base: i.base, archived: i.archived, triaged: i.triaged, answer: i.answer, priority_by: i.priority_by, ...(i.kind === "project" ? { due_date_by: i.due_date_by } : {}) },
		]),
	);
	const received: PushChange[][] = [];
	const acknowledged: AcknowledgedItem[][] = [];
	const uploads = new Map<string, string>();
	let next = 0;

	function apply(c: PushChange): PushResult {
		const refused = refuse(c);
		if (refused) return { ok: false, error: refused };
		if (c.op === "create") {
			const id = c.id ?? `ap${String(next++).padStart(3, "0")}`;
			const fields = { ...(c.kind === "task" ? { done_on: null } : {}), ...c.fields } as Record<string, unknown>;
			const now = held.get(id);
			if (now && (now.kind !== c.kind || Object.entries(c.fields).some(([k, v]) => now.fields[k] !== v))) {
				return { ok: false, error: `Id ${id} déjà pris` };
			}
			held.set(id, { kind: c.kind, fields, base: c.base ?? null, archived: false, triaged: true, answer: null, priority_by: null });
			return { ok: true, id };
		}
		const now = held.get(c.id);
		if (!now || now.kind !== c.kind) return { ok: false, error: `Élément inconnu : ${c.id}` };
		if (c.op === "archive") {
			now.archived = true;
			return { ok: true, id: c.id };
		}
		const changed = Object.entries(c.expected ?? {}).find(([k, v]) => now.fields[k] !== v);
		if (changed) return { ok: false, error: `${changed[0]} a changé dans l'app, valeur actuelle : ${JSON.stringify(now.fields[changed[0]])}` };
		if (c.op === "restore") now.archived = false;
		if ("status" in c.fields && c.fields.status !== now.fields.status) now.answer = null;
		if ("priority" in c.fields) now.priority_by = null;
		if ("due_date" in c.fields) now.due_date_by = null;
		Object.assign(now.fields, c.fields);
		if (c.base) now.base = c.base;
		return { ok: true, id: c.id };
	}

	const remote = {
		async push(changes: PushChange[]) {
			received.push(changes);
			return changes.map(apply);
		},
		async state(): Promise<ItemState[]> {
			return [...held].map(([id, h]) => ({ id, ...h }) as ItemState);
		},
		async acknowledge(items: AcknowledgedItem[]) {
			acknowledged.push(items);
			for (const a of items) {
				const now = held.get(a.id)!;
				now.base = JSON.parse(JSON.stringify(a.base)) as ItemBase;
				if (a.answer !== undefined && now.answer?.id === a.answer) now.answer = null;
			}
		},
		async upload(data: ArrayBuffer, name: string) {
			const key = new TextDecoder().decode(data);
			if (!uploads.has(key)) uploads.set(key, `/uploads/u${uploads.size}${name.slice(name.lastIndexOf("."))}`);
			return uploads.get(key)!;
		},
		async triage(id: string, as: TriageRequest): Promise<TriageResponse> {
			const item = held.get(id)!;
			item.triaged = true;
			if (as.as === "project") {
				item.kind = "project";
				item.fields = { title: item.fields.title, description: item.fields.description, status: as.priority === 0 ? "en_cours" : "a_faire", priority: as.priority, due_date: null };
				return { id, as: "project", fields: item.fields as unknown as ProjectFields };
			}
			const { base: _base, as: _as, ...set } = as;
			Object.assign(item.fields, set, { status: as.priority === 0 ? "en_cours" : "a_faire" });
			const { done_on: _done, ...fields } = item.fields as unknown as TaskStateFields;
			return { id, as: "task", fields: fields as never };
		},
	};
	return { remote: remote as unknown as Remote, received, acknowledged, held, uploads };
}

/** A Task as `GET /api/state` lists it. */
export function appTask(id: string, fields: Partial<TaskStateFields>, more: Partial<ItemState> = {}): ItemState {
	return {
		id,
		kind: "task",
		base: null,
		archived: false,
		triaged: true,
		answer: null,
		priority_by: null,
		fields: { title: "", type: "task", step: false, status: "a_faire", priority: 1, project_id: null, description: "", done_on: null, ...fields },
		...more,
	} as ItemState;
}

/** A Project as `GET /api/state` lists it. */
export function appProject(id: string, fields: Partial<ProjectFields>, more: Partial<ItemState> = {}): ItemState {
	return {
		id,
		kind: "project",
		base: null,
		archived: false,
		triaged: true,
		answer: null,
		priority_by: null,
		due_date_by: null,
		fields: { title: "", description: "", status: "a_faire", priority: 5, due_date: null, ...fields },
		...more,
	} as ItemState;
}

/** Obsidian's `processFrontMatter` on the flat `key: value` frontmatter of test notes (added if missing). */
function editFrontmatter(content: string, edit: (fm: Record<string, unknown>) => void): string {
	const lines = content.split("\n");
	const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
	const fm: Record<string, unknown> = {};
	for (const line of lines.slice(1, Math.max(end, 1))) {
		const [key, ...rest] = line.split(":");
		const value = rest.join(":").trim();
		fm[key!.trim()] = value === "true" ? true : /^\d+$/.test(value) ? Number(value) : value;
	}
	edit(fm);
	const yaml = Object.entries(fm).map(([k, v]) => `${k}: ${String(v)}`);
	return ["---", ...yaml, "---", ...lines.slice(end + 1)].join("\n");
}

/** Notes by path (`initial`, or that very map), read and edited as the Push does. */
export function memoryVault(initial: Record<string, string> | Map<string, string>) {
	const files = initial instanceof Map ? initial : new Map(Object.entries(initial));
	const vault: VaultFiles = {
		async read(path) {
			return files.get(path) ?? null;
		},
		async process(path, edit) {
			const content = files.get(path);
			if (content === undefined) throw new Error(`no file ${path}`);
			files.set(path, edit(content));
		},
		async processFrontMatter(path, edit) {
			const content = files.get(path);
			if (content === undefined) throw new Error(`no file ${path}`);
			files.set(path, editFrontmatter(content, edit));
		},
		paths: () => [...files.keys()],
	};
	return { files, vault };
}

/** The app as the plans see it when it holds exactly these bases, its current fields equal to them. */
export function appWith(
	projects: Record<string, { path: string; fields: object }> = {},
	tasks: Record<string, { path: string; fields: object }> = {},
): AppItems {
	return appItems([
		...Object.entries(projects).map(([id, b]) => appProject(id, b.fields, { base: b })),
		...Object.entries(tasks).map(([id, b]) => appTask(id, b.fields, { base: b })),
	]);
}

const now = new Date("2026-10-20T10:00:00Z");

/** A vault and an app; `plan`, `push` and `pull` go through the same steps as the commands, `pick` as a conflict's button. */
export function pushWorld(notes: Record<string, string>, items: ItemState[] = [], refuse?: (c: PushChange) => string | undefined) {
	const app = fakeSuivi(items, refuse);
	const v = memoryVault(notes);
	const all = (): Note[] => [...v.files].map(([path, content]) => ({ path, content }));
	const read = () =>
		readVaultItems(
			all().filter((n) => n.path.startsWith("2.projects/")),
			all(),
			(n) => (n.path.startsWith("2.projects/") ? n.path : null),
		);
	const plan = async () => planPush(read(), await fetchAppItems(app.remote), now);
	const push = async (selected?: PendingChange[]) =>
		runPush(selected ?? (await plan()), {
			remote: app.remote,
			app: await fetchAppItems(app.remote),
			...vaultWriters(v.vault),
			// Each embed's link text stands for the image's bytes.
			shareBody: (_path, body) => shareBody(body, (link) => app.remote.upload(new TextEncoder().encode(link).buffer as ArrayBuffer, link)),
		});
	const pull = () => runPull({ remote: app.remote, files: v.vault, vault: read() });
	const pick = (conflict: Conflict, choice: "mine" | "theirs") => pickConflict(conflict, choice, { remote: app.remote, files: v.vault });
	return { app, files: v.files, vault: v.vault, plan, push, pull, pick };
}
