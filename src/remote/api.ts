/**
 * Plugin API contract: request and response bodies of everything under `/api`.
 *
 * This repo owns it. The projects-timer plugin keeps a verbatim copy
 * (`src/remote/api.ts`), so this file must stay self-contained: no imports,
 * types and constants only.
 *
 * Every request carries `Authorization: Bearer <token>` (a Developer's API
 * token from Paramètres). Errors other than per-change Push errors come back
 * as `ApiError` with status 400 (bad body), 401 (missing, unknown or revoked
 * token) or 403 (token of a user who isn't a Developer).
 */

export interface ApiError {
  error: string;
}

/** Project status codes; the app shows them as À faire, En cours, En pause, À valider, Terminé. */
export const PROJECT_STATUSES = ["a_faire", "en_cours", "en_pause", "a_valider", "termine"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Fields of a Project the Developer sets by Push. Priority 0 is P0 (En cours), 1–5 are P1–P5. */
export interface ProjectFields {
  title: string;
  /** Markdown. */
  description: string;
  status: ProjectStatus;
  priority: number;
}

/**
 * Task type codes; the app shows them as Tâche, Bug, Tâche rapide, En attente,
 * Étape de projet, Amélioration, Idée. The last two only come from the Client.
 */
export const TASK_TYPES = ["task", "bug", "quick", "wait", "step", "amelioration", "idea"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
/** Types a Push may set: the vault's tags (`#task`, `#bug`, `#quick`, `#wait`) and Project steps. */
export const PUSHED_TASK_TYPES = ["task", "bug", "quick", "wait", "step"] as const;
export type PushedTaskType = (typeof PUSHED_TASK_TYPES)[number];

/** Task status codes; the app shows them as À trier, À faire, En cours, À valider, Terminé. */
export const TASK_STATUSES = ["a_trier", "a_faire", "en_cours", "a_valider", "termine"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Statuses a Push may set (À trier exists only in the app). */
export const PUSHED_TASK_STATUSES = ["a_faire", "en_cours", "a_valider", "termine"] as const;
export type PushedTaskStatus = (typeof PUSHED_TASK_STATUSES)[number];

/**
 * Fields of a Task the Developer sets by Push: the line only, never its body.
 * Vault mapping: `p0` = en_cours + priority 0, `p1`–`p5` = a_faire + that
 * priority, `pr` = a_valider, `#done <date>` / `[x]` = termine.
 */
export interface TaskFields {
  title: string;
  type: PushedTaskType;
  status: PushedTaskStatus;
  /** 0–5, or null = inherit the Project's Priority (a Project step without token). */
  priority: number | null;
  /** App id of the Project, null for a standalone Task. */
  project_id: string | null;
  /** `YYYY-MM-DD` the Task was done (`#done <date>`); null or absent = the Push date when it becomes termine. */
  done_on?: string | null;
}

/** One vault change in a Push. Items are addressed by the id the app gave them at creation. */
export type PushChange =
  | { op: "create"; kind: "project"; fields: ProjectFields }
  | { op: "update"; kind: "project"; id: string; fields: Partial<ProjectFields> }
  | { op: "archive"; kind: "project"; id: string }
  | { op: "create"; kind: "task"; fields: TaskFields }
  | { op: "update"; kind: "task"; id: string; fields: Partial<TaskFields> }
  | { op: "archive"; kind: "task"; id: string };

/** `POST /api/push` body. */
export interface PushRequest {
  changes: PushChange[];
}

/**
 * Outcome of one change. A change that is invalid, targets an unknown item or
 * sets a field the Developer doesn't own fails alone; the others still apply.
 */
export type PushResult = { ok: true; id: string } | { ok: false; error: string };

/** `POST /api/push` response: one result per change, in the order sent. */
export interface PushResponse {
  results: PushResult[];
}
