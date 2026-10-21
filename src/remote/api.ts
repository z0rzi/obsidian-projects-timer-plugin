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
 * Amélioration, Idée. The last two only come from the Client. A Project step
 * is not a type but the `step` flag: a step has a type like any Task.
 */
export const TASK_TYPES = ["task", "bug", "quick", "wait", "amelioration", "idea"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
/** Types a Push may set: the vault's tags (`#task`, `#bug`, `#quick`, `#wait`); no tag = `task`. */
export const PUSHED_TASK_TYPES = ["task", "bug", "quick", "wait"] as const;
export type PushedTaskType = (typeof PUSHED_TASK_TYPES)[number];

/** Task status codes; the app shows them as À trier, À faire, En cours, À valider, Terminé. */
export const TASK_STATUSES = ["a_trier", "a_faire", "en_cours", "a_valider", "termine"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Statuses a Push may set (À trier exists only in the app). */
export const PUSHED_TASK_STATUSES = ["a_faire", "en_cours", "a_valider", "termine"] as const;
export type PushedTaskStatus = (typeof PUSHED_TASK_STATUSES)[number];

/**
 * Fields of a Task the Developer sets by Push: the line and its body.
 * Vault mapping: `p0` = en_cours + priority 0, `p1`–`p5` = a_faire + that
 * priority, `pr` = a_valider, `#done <date>` / `[x]` = termine.
 */
export interface TaskFields {
  title: string;
  type: PushedTaskType;
  status: PushedTaskStatus;
  /**
   * The Task's Description: its vault body, de-indented, shared like a Review
   * body (images uploaded, wikilinks to text). A Push may omit it on create (`""`).
   */
  description: string;
  /** 0–5, or null = inherit the Project's Priority (a Project step without token). */
  priority: number | null;
  /** App id of the Project, null for a standalone Task. */
  project_id: string | null;
  /** `YYYY-MM-DD` the Task was done (`#done <date>`); null or absent = the Push date when it becomes termine. */
  done_on?: string | null;
  /** A Project step (a line of the Project's steps list); false for a Tag task. A line moved between the two changes it. */
  step: boolean;
}

/**
 * Fields of a Review the Developer sets by Push (a note of the vault's reviews
 * folder). Creating it publishes it: the Client is emailed and the linked Task
 * becomes a_valider. Updating title or body of a Review answered À reprendre
 * publishes it again (back to en_attente, Task a_valider again).
 */
export interface ReviewFields {
  title: string;
  /**
   * Markdown, shared whole. Images are `![](/uploads/<name>)` (upload them
   * first); a Loom share URL alone on a line becomes an embedded player.
   */
  body: string;
  /** App id of the Project the Review is about. */
  project_id: string;
  /** App id of the Task it asks to validate, or null. */
  task_id: string | null;
}

/** Review answer codes; the app shows them as En attente, Validé, À reprendre. */
export const REVIEW_ANSWERS = ["en_attente", "valide", "a_reprendre"] as const;
export type ReviewAnswer = (typeof REVIEW_ANSWERS)[number];

/**
 * Payload of `review.answered` (the item is the Review): the Client's answer
 * and the Task it settles. `valide` makes the Task termine (vault: `#done
 * <date>`), `a_reprendre` makes it en_cours P0 (vault: `p0`); the app emits
 * those Task changes as `item.updated` events carrying `review: <review id>`.
 */
export interface ReviewAnsweredPayload {
  answer: Exclude<ReviewAnswer, "en_attente">;
  task_id: string | null;
}

/** One vault change in a Push. Items are addressed by the id the app gave them at creation. */
export type PushChange =
  | { op: "create"; kind: "project"; fields: ProjectFields }
  | { op: "update"; kind: "project"; id: string; fields: Partial<ProjectFields> }
  | { op: "archive"; kind: "project"; id: string }
  | { op: "create"; kind: "task"; fields: TaskFields }
  | { op: "update"; kind: "task"; id: string; fields: Partial<TaskFields> }
  | { op: "archive"; kind: "task"; id: string }
  | { op: "create"; kind: "review"; fields: ReviewFields }
  | { op: "update"; kind: "review"; id: string; fields: Partial<ReviewFields> }
  | { op: "archive"; kind: "review"; id: string };

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

/**
 * Where an event was written from: `push` by `POST /api/push`, `api` by the
 * other plugin calls (comments, triage, read marks), `site` by the browser.
 */
export type EventOrigin = "push" | "api" | "site";

/** One entry of the event log, as the Pull returns it. */
export interface ApiEvent {
  /** Monotonic; the Pull cursor. */
  id: number;
  /** ISO date-time. */
  at: string;
  /** Id of the user who made the change (Developer for Push events, else usually the Client). */
  actor: string;
  origin: EventOrigin;
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
  /**
   * Handles of the users the body mentions (`@jmj` → "jmj"), in writing
   * order; an `@` naming nobody is not listed. The body stays raw: highlight
   * these when rendering.
   */
  mentions: string[];
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

/**
 * An Inbox Notification: something the Client did that the Developer only
 * needs to read. Built from an event of the log; the Developer's own events
 * never appear.
 */
export interface InboxNotification {
  /** Id of the event; send it to `POST /api/events/read`. */
  id: number;
  /** ISO date-time. */
  at: string;
  actor_email: string;
  /**
   * `comment.created`: a new comment; `item.updated`: a Client priority change (`from` → `to`);
   * `review.answered`: the Client answered a Review (`answer`). The Task changes an answer causes
   * are not Notifications of their own.
   */
  type: "comment.created" | "item.updated" | "review.answered";
  /** The Project, Task or Review concerned (for a comment, the one it's on). */
  item_id: string;
  item_kind: "project" | "task" | "review";
  item_title: string;
  /** `comment.created`: id and current text of the comment. */
  comment_id?: string;
  body?: string;
  /** `item.updated`: the field changed and its old and new values. */
  field?: string;
  from?: unknown;
  to?: unknown;
  /** `review.answered`: the answer given. */
  answer?: ReviewAnsweredPayload["answer"];
}

/**
 * An Inbox À trier entry: an item the Client proposed that waits for Triage
 * (status `a_trier`): Bug and Amélioration Tickets (triaged as a Task) and
 * Ideas the Client launched (`type: "idea"`, triaged as a Project). It leaves
 * the list once triaged, so there is nothing to mark read.
 */
export interface InboxTicket {
  /** App id; becomes the `^id` of the Task line, or the `suivi_id:` of the Project file, written at Triage. */
  id: string;
  type: TaskType;
  title: string;
  /** Markdown. Uploaded images are `![](/uploads/<name>)`, relative to the app URL. */
  description: string;
  /** ISO date-time. */
  created_at: string;
  author_email: string;
}

/**
 * `GET /api/inbox` response: the Notifications the Developer hasn't marked
 * read, oldest first. Comments since deleted and archived items are left out.
 * `to_triage`: the À trier section, oldest first.
 */
export interface InboxResponse {
  notifications: InboxNotification[];
  to_triage: InboxTicket[];
}

/**
 * One entry of the Activity feed: an event of the log enriched for display.
 * The Developer's Push events collapse to one entry per Push (`push`); the
 * events a Push wrote are not entries.
 */
export interface ActivityEntry {
  /** Id of the event; send it to `POST /api/events/read`. */
  id: number;
  /** ISO date-time. */
  at: string;
  actor: {
    email: string;
    /** The `@handle` of the user, null while none is set. */
    handle: string | null;
    role: "client" | "developer";
  };
  origin: EventOrigin;
  type: EventType;
  /** French, e.g. "Commentaire", "Priorité : P3 → P1", "Push : 12 changements". */
  label: string;
  /** The Project, Task or Review concerned (for a comment, the one it's on); absent once archived. */
  item?: { kind: "project" | "task" | "review"; id: string; title: string };
  /** Comment events: the comment; `body` absent once deleted. `mentions`: handles of the users mentioned (see `Comment`). */
  comment?: { id: string; body?: string; mentions: string[] };
  /** `item.updated`: the field changed and its old and new values. */
  field?: string;
  from?: unknown;
  to?: unknown;
  /** `review.answered`: the answer given. */
  answer?: ReviewAnsweredPayload["answer"];
  /** `push.completed`: the Push's counts. */
  push?: { applied: number; rejected: number };
  /** An event by a Client the caller hasn't marked read; the caller's own events and Pushes never are. */
  unread: boolean;
}

/**
 * `GET /api/activity?before=<event id>&days=<n>` response, newest first.
 * Without `before`: the entries of the last `days` days (default 30) from now.
 * With it: the entries older than `before`, spanning `days` days back from the
 * newest of them. `next` is the `before` of the page after, null when there is
 * nothing older (an empty first page still points at older entries).
 */
export interface ActivityResponse {
  entries: ActivityEntry[];
  next: number | null;
  /** The caller's total number of unread entries, loaded or not. */
  unread: number;
}

/**
 * `POST /api/events/read` body: events to mark read for the caller, either
 * listed (unknown ids are ignored) or every Client event up to `upto` included.
 */
export type MarkReadRequest = { ids: number[] } | { upto: number };

/** `POST /api/events/read` response. */
export interface MarkReadResponse {
  ok: true;
}

/** Types a Ticket may be given at Triage: the vault's Tag task tags. */
export const TRIAGE_TASK_TYPES = ["task", "bug", "quick", "wait"] as const;
export type TriageTaskType = (typeof TRIAGE_TASK_TYPES)[number];

/**
 * `POST /api/items/:id/triage` body: what an item À trier becomes.
 * `as: "task"` (Bug and Amélioration Tickets): a Task of `type` with
 * `priority` (0 = En cours, 1–5 = À faire) in Project `project_id` (null =
 * standalone), a Project step when `step` (then `priority` may be null =
 * inherit the Project's, no token on the line). `as: "project"` (launched
 * Ideas, "Nouveau projet"): a Project with `priority` (0 = En cours, 1–5 = À
 * faire), title and description taken from the Idea, which then shows lancée.
 * Either way the item keeps its id, description and comments. 404 for an
 * unknown item, 409 for one not À trier or not of that kind, 400 for a bad
 * body.
 */
export type TriageRequest =
  | {
      as: "task";
      type: TriageTaskType;
      step: boolean;
      priority: number | null;
      project_id: string | null;
    }
  | {
      as: "project";
      priority: number;
    };

/**
 * `POST /api/items/:id/triage` response: the item's shared fields now, i.e.
 * what the vault writes (the Task line, or the new Project file).
 */
export type TriageResponse =
  | { id: string; as: "task"; fields: TaskFields }
  | { id: string; as: "project"; fields: ProjectFields };
