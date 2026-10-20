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

/** Event types of the log (docs/spec.md "Event types"). */
export const EVENT_TYPES = [
  "project.created",
  "task.created",
  "item.updated",
  "item.archived",
  "ticket.created",
  "idea.launched",
  "item.triaged",
  "review.published",
  "review.answered",
  "comment.created",
  "comment.edited",
  "comment.deleted",
  "push.completed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** One entry of the event log, as the Pull returns it. */
export interface ApiEvent {
  /** Monotonic; the Pull cursor. */
  id: number;
  /** ISO date-time. */
  at: string;
  /** Id of the user who made the change (Developer for Push events, else usually the Client). */
  actor: string;
  type: EventType;
  /** Id of the Project, Task, Review or Comment concerned; null for batch events. */
  item: string | null;
  /** Shape depends on `type`, e.g. `ItemUpdatedPayload` for `item.updated`. */
  payload: Record<string, unknown>;
}

/**
 * Payload of `item.updated`: one field of a Project or Task changed. A Client
 * priority change is `{ field: "priority", from, to }` with `to` in 1–5 (`from`
 * null = a Project step that inherited its Project's).
 */
export interface ItemUpdatedPayload {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * `GET /api/events?since=<cursor>` response (Pull): events with id greater than
 * `since` (absent = 0, i.e. everything), oldest first, and the cursor to send
 * next time (`since` itself when there is nothing new).
 */
export interface EventsResponse {
  events: ApiEvent[];
  cursor: number;
}

/**
 * One comment of a thread. Projects, Tasks and Reviews each have one thread,
 * addressed by the item's id. Deleted comments are never returned.
 */
export interface Comment {
  id: string;
  /** Id of the Project, Task or Review the comment is on. */
  item_id: string;
  author_id: string;
  author_email: string;
  author_role: "client" | "developer";
  /** Markdown. Uploaded images are `![](/uploads/<name>)`, relative to the app URL. */
  body: string;
  /** ISO date-times. `edited_at` is set once edited (shown "modifié"). */
  created_at: string;
  edited_at: string | null;
  /** The caller wrote it, so may edit or delete it. */
  mine: boolean;
}

/** `GET /api/items/:id/comments` response: the thread, oldest first. 404 for an unknown item. */
export interface CommentsResponse {
  comments: Comment[];
}

/**
 * `POST /api/items/:id/comments` (answers 201) and `PATCH /api/comments/:id`
 * body. An empty body is a 400; editing someone else's comment a 403.
 */
export interface CommentRequest {
  body: string;
}

/** `POST /api/items/:id/comments` and `PATCH /api/comments/:id` response. */
export interface CommentResponse {
  comment: Comment;
}

/** `DELETE /api/comments/:id` response (403 for someone else's comment). */
export interface DeleteCommentResponse {
  ok: true;
}

/** Image types `POST /api/uploads` accepts (multipart field `file`), at most `UPLOAD_MAX_BYTES`. */
export const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** `POST /api/uploads` response: path of the image, relative to the app URL (`/uploads/<name>`). */
export interface UploadResponse {
  url: string;
}
