// In-memory stand-ins for the Client app (`Remote`) and the vault (`VaultFiles`), for Push tests.
import type { AcknowledgedItem, ItemBase, ItemState, LaunchRequest, LaunchResponse, ProjectFields, PushChange, PushResult, StateAnswer, TaskStateFields, TriageRequest, TriageResponse } from "../src/remote/api";
import { RemoteError, type Remote } from "../src/remote/remote";
import { appItems, fetchAppItems, type AppItems } from "../src/sync/appState";
import type { Conflict } from "../src/sync/compareState";
import { pickConflict } from "../src/sync/conflicts";
import { planPush, readVaultItems, type Note } from "../src/sync/planPush";
import type { PendingChange } from "../src/sync/pushPlan";
import { runPush, vaultWriters } from "../src/sync/runPush";
import { shareBody } from "../src/sync/sharedBody";
import { runPull, type VaultFiles } from "../src/sync/runPull";
import type { LinkResolver } from "../src/sync/projectLink";

type Held = {
	kind: "project" | "task";
	fields: Record<string, unknown>;
	base: ItemBase | null;
	archived: boolean;
	triaged: boolean;
	answer: StateAnswer | null;
	priority_by: string | null;
	due_date_by?: string | null;
	/** A Task's snooze (`POST /items/:id/garder`). */
	kept_until?: string | null;
	/** A Ticket's latest change (`InboxTicket.changed_at`) when edited since the test began (`editTicket`). */
	changed_at?: string;
};

/**
 * An app holding `items` that applies Pushes as `src/items/push.ts` does: a
 * create keeps the id sent (a retried one with the same fields is ok), a
 * change whose `expected` no longer holds is refused, `base` is stored, a
 * change of Priority or Done drops the Answer. Done work keeps no Priority; an
 * open Project, or a reopened Task outside any Project, without one is refused.
 * The Rapide rules hold: a Project never takes `pq`, only a `quick` Tag task
 * (not a step) does, and open it has `pq` or `pz`. Acknowledges store the base and clear
 * the Answer they name. Uploads are deduplicated by content. « Lancer en projet » makes a
 * Triaged `idea` Task the Project sent, same id, as `src/items/launch.ts` does, with its HTTP refusals.
 * Triage and « Archiver » take only an item À trier (404 unknown or archived, 409 Triaged); Triage also answers
 * 409 when the Ticket changed after its `expected` (`editTicket`, its author's Modifier).
 * A keep sets a Task's `kept_until` (404 unknown, archived or a Project), no event. Triage, « Archiver » and
 * a keep are the Deck's writes: `deck.at` (`deck_at` of the state) takes the time of the latest.
 */
export function fakeSuivi(items: ItemState[] = [], refuse: (c: PushChange) => string | undefined = () => undefined) {
	const held = new Map<string, Held>(
		items.map((i) => [
			i.id,
			{ kind: i.kind, fields: { ...i.fields }, base: i.base, archived: i.archived, triaged: i.triaged, answer: i.answer, priority_by: i.priority_by, ...(i.kind === "project" ? { due_date_by: i.due_date_by } : { kept_until: i.kept_until ?? null }) },
		]),
	);
	const received: PushChange[][] = [];
	const acknowledged: AcknowledgedItem[][] = [];
	const uploads = new Map<string, string>();
	let next = 0;
	/** « Archiver » calls of the Deck, with their comment. */
	const archivedWith: [string, string | null][] = [];
	/** Triage requests, as the plugin sent them. */
	const triageRequests: TriageRequest[] = [];
	/** When the Deck last wrote (`deck_at`), as an ISO date-time; null before any Triage, archive or keep. */
	const deck = { at: null as string | null };
	const deckWrote = () => {
		deck.at = new Date().toISOString();
	};
	const refused = (status: number, error: string) => new RemoteError("server", `Suivi error (HTTP ${status}): ${error}`, status);
	/** An item À trier, as Triage and « Archiver » refuse others: 404 unknown or archived, 409 Triaged. */
	function toTriage(id: string): Held {
		const item = held.get(id);
		if (!item || item.archived) throw refused(404, "Élément introuvable");
		if (item.triaged) throw refused(409, `Pas à trier : ${id}`);
		return item;
	}

	/** The app's Rapide refusals (`checkRapide`, `NO_RAPIDE`) on the fields a change leaves. */
	function rapideRefusal(kind: "project" | "task", f: { type?: unknown; step?: unknown; done?: unknown; priority?: unknown }): string | undefined {
		if (kind === "project") return f.priority === "pq" ? "Un projet n'a pas la priorité Rapide" : undefined;
		const rapide = f.type === "quick" && !f.step;
		if (f.priority === "pq" && !rapide) return "La priorité Rapide est celle d'une tâche rapide hors étapes";
		if (rapide && !f.done && f.priority !== "pq" && f.priority !== "pr" && f.priority !== "pz") return "Une tâche rapide n'a pas de priorité";
		return undefined;
	}

	function apply(c: PushChange): PushResult {
		const refused = refuse(c);
		if (refused) return { ok: false, error: refused };
		if (c.op === "create") {
			const id = c.id ?? `ap${String(next++).padStart(3, "0")}`;
			const fields = { ...(c.kind === "task" ? { done_on: null } : {}), ...c.fields, ...(c.fields.done ? { priority: null } : {}) } as Record<string, unknown>;
			if (c.kind === "project" && !fields.done && fields.priority == null) return { ok: false, error: "Un projet ouvert a besoin d'une priorité" };
			if (c.kind === "task" && !fields.done && fields.priority == null && fields.project_id == null) {
				return { ok: false, error: "Une tâche ouverte hors projet a besoin d'une priorité" };
			}
			const rapide = rapideRefusal(c.kind, c.kind === "project" ? c.fields : fields);
			if (rapide) return { ok: false, error: rapide };
			const now = held.get(id);
			if (now && (now.kind !== c.kind || Object.entries(c.fields).some(([k, v]) => now.fields[k] !== v))) {
				return { ok: false, error: `Id ${id} déjà pris` };
			}
			held.set(id, { kind: c.kind, fields, base: c.base ?? null, archived: false, triaged: true, answer: null, priority_by: null, ...(c.kind === "task" ? { kept_until: null } : {}) });
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
		const done = c.fields.done ?? now.fields.done;
		const priority = done ? null : c.fields.priority !== undefined ? c.fields.priority : now.fields.done ? null : now.fields.priority;
		const projectId = "project_id" in c.fields ? c.fields.project_id : now.fields.project_id;
		if (!done && priority == null && c.kind === "project") return { ok: false, error: "Un projet ouvert a besoin d'une priorité" };
		if (!done && priority == null && projectId == null) return { ok: false, error: "Une tâche ouverte hors projet a besoin d'une priorité" };
		const rapide = rapideRefusal(c.kind, c.kind === "project" ? c.fields : { ...now.fields, ...c.fields, done, priority });
		if (rapide) return { ok: false, error: rapide };
		if (done !== now.fields.done || priority !== now.fields.priority) now.answer = null;
		if ("priority" in c.fields) now.priority_by = null;
		if ("due_date" in c.fields) now.due_date_by = null;
		Object.assign(now.fields, c.fields, { done, priority });
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
		async fullState() {
			return { items: await remote.state(), zones: [], deck_at: deck.at };
		},
		async keep(id: string, until: string | null) {
			const item = held.get(id);
			if (!item || item.archived || item.kind !== "task") throw refused(404, "Élément introuvable");
			item.kept_until = until;
			deckWrote();
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
			triageRequests.push(as);
			// The app's `checkRapide` on the Task Triage makes (a Tag task, open), as it checks the request: first.
			const rapide = rapideRefusal("task", { type: as.type, step: false, done: false, priority: as.priority ?? null });
			if (rapide) throw refused(400, rapide);
			const item = toTriage(id);
			if (as.expected !== undefined && item.changed_at !== undefined && item.changed_at > as.expected) {
				throw refused(409, `Modifiée depuis : ${id}`);
			}
			item.triaged = true;
			deckWrote();
			const { base: _base, as: _as, expected: _expected, ...set } = as;
			Object.assign(item.fields, set);
			const { done_on: _done, ...fields } = item.fields as unknown as TaskStateFields;
			return { id, as: "task", fields: fields as never };
		},
		async archiveTicket(id: string, comment: string | null) {
			toTriage(id).archived = true;
			archivedWith.push([id, comment]);
			deckWrote();
		},
		async launch(id: string, request: LaunchRequest): Promise<LaunchResponse> {
			const item = held.get(id);
			if (item?.kind === "project") throw refused(409, `Déjà un projet : ${id}`);
			if (!item || item.archived) throw refused(404, "Élément introuvable");
			if (item.fields.type !== "idea" || !item.triaged) throw refused(409, `Seule une idée triée devient un projet : ${id}`);
			const fields = { description: "", done: false, due_date: null, ...request.fields } as ProjectFields;
			if (!fields.title?.trim()) throw refused(400, "Champ manquant : title");
			const rapide = rapideRefusal("project", fields);
			if (rapide) throw refused(400, rapide);
			if (fields.done) fields.priority = null;
			else if (fields.priority == null) throw refused(400, "Un projet ouvert a besoin d'une priorité");
			held.set(id, { kind: "project", fields: { ...fields }, base: request.base ?? null, archived: false, triaged: true, answer: null, priority_by: null, due_date_by: null });
			return { id, fields };
		},
	};
	/** The author's Modifier on Ticket `id` at `at` (ISO date-time): its fields change, and its `changed_at`. */
	const editTicket = (id: string, fields: Record<string, unknown>, at: string) => {
		const item = held.get(id)!;
		Object.assign(item.fields, fields);
		item.changed_at = at;
	};
	return { remote: remote as unknown as Remote, received, acknowledged, held, uploads, archivedWith, triageRequests, deck, editTicket };
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
		kept_until: null,
		fields: { title: "", type: "task", step: false, priority: 1, done: false, project_id: null, description: "", done_on: null, ...fields },
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
		fields: { title: "", description: "", priority: 5, done: false, due_date: null, ...fields },
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

/**
 * Obsidian's link resolver over the notes at `paths`: a linkpath is a note's
 * path without `.md`, or the end of one after a `/` (its name alone, most
 * often); the first such note wins.
 */
export function fakeLinks(paths: () => string[]): LinkResolver {
	return {
		getFirstLinkpathDest(linkpath) {
			const file = `${linkpath}.md`;
			const path = paths().find((p) => p === file) ?? paths().find((p) => p.endsWith(`/${file}`));
			return path ? { path } : null;
		},
	};
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
			fakeLinks(() => [...v.files.keys()]),
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
