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

/**
 * Priority codes of open work, Project or Task: 0 is P0 (« En ce moment »),
 * 1–5 are P1–P5, `"pr"` is PR (« À valider »: waiting for the Client's
 * Answer). There is no status besides it: work is open at a Priority, or Done.
 */
export const PRIORITIES = [0, 1, 2, 3, 4, 5, "pr"] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Fields of a Project the Developer sets by Push. Vault mapping: `priority:
 * 0`–`5` or `priority: pr`; `archived: true` = `done` (Livré). The `status:`
 * key of a Project note means nothing here.
 */
export interface ProjectFields {
  title: string;
  /** Markdown. */
  description: string;
  /**
   * Null once Done: Done work has no Priority, and one pushed with Done is
   * not kept. Required while open: a Push creating an open Project or
   * reopening one sends one, and can't set it to null. A Push creating a
   * Project already Done may send null or omit it.
   */
  priority: Priority | null;
  /** Livré: the Push (or the Answer Validé) that sets it dates it. */
  done: boolean;
  /**
   * Échéance: a month "YYYY-MM", or null for none (vault: `due_date:`
   * frontmatter). A Push may omit it on create (none); any other string is
   * refused.
   */
  due_date: string | null;
}

/**
 * Task type codes; the app shows them as Tâche, Bug, Rapide, En attente,
 * Amélioration, Idée. The last two only come from Nouvelle demande (Client or Developer). A Project step
 * is not a type but the `step` flag: a step has a type like any Task.
 */
export const TASK_TYPES = ["task", "bug", "quick", "wait", "amelioration", "idea"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
/** Types a Push may set: the vault's tags (`#task`, `#bug`, `#quick`, `#wait`); no tag = `task`. */
export const PUSHED_TASK_TYPES = ["task", "bug", "quick", "wait"] as const;
export type PushedTaskType = (typeof PUSHED_TASK_TYPES)[number];

/**
 * Fields of a Task the Developer sets by Push: the line and its body.
 * Vault mapping: the token `p0`–`p5` or `pr` = `priority`, `[x]` / `#done
 * <date>` = `done` (Terminé).
 */
export interface TaskFields {
  title: string;
  type: PushedTaskType;
  /**
   * The Task's Description: its vault body, de-indented, shared with images
   * uploaded and wikilinks turned to text. A Push may omit it on create (`""`).
   */
  description: string;
  /**
   * Null = inherit the Project's Priority, PR included (a Project step
   * without token). Null once Done: Done work has no Priority, and one pushed
   * with Done is not kept. A Push reopening a Task outside any Project
   * (`project_id` null) sends one; a Task in a Project may inherit.
   */
  priority: Priority | null;
  /** App id of the Project, null for a standalone Task. */
  project_id: string | null;
  /** Terminé. */
  done: boolean;
  /** `YYYY-MM-DD` the Task was done (`#done <date>`); null or absent = the Push date when it becomes done. */
  done_on?: string | null;
  /** A Project step (a line of the Project's steps list); false for a Tag task. A line moved between the two changes it. */
  step: boolean;
}

/** Answer codes of the Client on a Task or Project at PR; the app shows them as Validé, À reprendre. */
export const ITEM_ANSWERS = ["valide", "a_reprendre"] as const;
export type ItemAnswer = (typeof ITEM_ANSWERS)[number];

/**
 * Payload of `item.answered` (the item is the Task or Project, which was at
 * PR by its own Priority: a step inheriting PR is never answered): the
 * Client's Answer and the comment given with it (required for `a_reprendre`,
 * else null when none). `valide` makes it done (vault: Task `#done <date>`,
 * `[x]` for a step; Project `archived: true`), its steps untouched;
 * `a_reprendre` puts it at priority 0 (vault: Task `p0`, Project `priority:
 * 0`). The app emits those changes as `item.updated` events (`done`, or
 * `priority`) carrying `answer: <id of the item.answered event>`, right after it.
 */
export interface ItemAnsweredPayload {
  answer: ItemAnswer;
  comment_id: string | null;
}

/**
 * An Item's base: its shared fields as the vault last agreed with the app, in
 * the vault's own form (the plugin's `{ path, fields }` record). The plugin
 * writes it (Push, Triage, `POST /api/state/acknowledge`) and reads it back
 * from `GET /api/state`; the app stores any JSON object as sent and never
 * interprets it.
 */
export type ItemBase = { [key: string]: unknown };

/**
 * One vault change in a Push. Items are addressed by their app id.
 * `create`: `id` is the one the plugin generated and wrote into the note (5
 * characters `a-z0-9`; absent = the app picks one). An id the app already
 * holds is refused, unless it is the same kind with the same fields: a retried
 * create, answered ok without creating twice. `restore`: unarchives the Item
 * and applies `fields`. `expected`: the app values the plugin saw for the
 * fields it sends; when one no longer holds, the change is refused, naming the
 * field and its current value (absent = no check). `base`: the Item's base
 * once the change applies, stored with it (absent = the base stays as it was).
 */
export type PushChange =
  | { op: "create"; kind: "project"; id?: string; fields: ProjectFields; base?: ItemBase }
  | { op: "update"; kind: "project"; id: string; fields: Partial<ProjectFields>; expected?: Partial<ProjectFields>; base?: ItemBase }
  | { op: "restore"; kind: "project"; id: string; fields: Partial<ProjectFields>; expected?: Partial<ProjectFields>; base?: ItemBase }
  | { op: "archive"; kind: "project"; id: string }
  | { op: "create"; kind: "task"; id?: string; fields: TaskFields; base?: ItemBase }
  | { op: "update"; kind: "task"; id: string; fields: Partial<TaskFields>; expected?: Partial<TaskStateFields>; base?: ItemBase }
  | { op: "restore"; kind: "task"; id: string; fields: Partial<TaskFields>; expected?: Partial<TaskStateFields>; base?: ItemBase }
  | { op: "archive"; kind: "task"; id: string };

/** `POST /api/push` body. */
export interface PushRequest {
  changes: PushChange[];
}

/**
 * Outcome of one change; `id` is the Item's (on create, the one sent). A
 * change that is invalid, targets an unknown item, sets a field the Developer
 * doesn't own or expects a value that no longer holds fails alone; the others
 * still apply.
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
  "item.answered",
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

/** One entry of the event log, as `GET /api/events` returns it. */
export interface ApiEvent {
  /** Monotonic. */
  id: number;
  /** ISO date-time. */
  at: string;
  /** Id of the user who made the change (Developer for Push events, else usually the Client). */
  actor: string;
  origin: EventOrigin;
  type: EventType;
  /** Id of the Project, Task or Comment concerned; null for batch events. */
  item: string | null;
  /** Shape depends on `type`, e.g. `ItemUpdatedPayload` for `item.updated`. */
  payload: Record<string, unknown>;
}

/**
 * Payload of `item.updated`: one field of a Project or Task changed, with its
 * old and new values. A Client priority change is `{ field: "priority", from,
 * to }` with `to` in 1–5 (`from` null = a Project step that inherited its
 * Project's). Becoming Done is `{ field: "done", from: false, to: true }`,
 * reopening the reverse with the `priority` the item comes back at. A Description change carries no values: `handles` lists the
 * Mention handles before and after instead. A change an Answer caused carries
 * `answer`, the id of its `item.answered` event.
 */
export interface ItemUpdatedPayload {
  field: string;
  from?: unknown;
  to?: unknown;
  handles?: { from: string[]; to: string[] };
  /** On reopening only: the Priority it comes back at (null for a Task inheriting its Project's). */
  priority?: Priority | null;
  answer?: number;
}

/**
 * `GET /api/events?since=<id>` response: events with id greater than `since`
 * (absent = 0, i.e. everything), oldest first, and the `since` to send next
 * time (`since` itself when there is nothing new). The plugin doesn't use it:
 * the Pull compares state (`GET /api/state`).
 */
export interface EventsResponse {
  events: ApiEvent[];
  cursor: number;
}

/**
 * One comment of a thread. Projects and Tasks each have one thread,
 * addressed by the item's id. Deleted comments are never returned.
 */
export interface Comment {
  id: string;
  /** Id of the Project or Task the comment is on. */
  item_id: string;
  author_id: string;
  author_email: string;
  author_role: "client" | "developer";
  /** Markdown. Uploaded files are `![](/uploads/<name>)` (images) or `[nom](/uploads/<name>)`, relative to the app URL. */
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

/**
 * `POST /api/uploads` (multipart field `file`, optional field `item_id`) takes any file type. These raster
 * images are served inline (`![](url)`); everything else, SVG and HTML included, as a download (`[nom](url)`).
 */
export const INLINE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
/** Per file (413 above). */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** All the files of one item, its Description and comments (413 above, with what is left). */
export const UPLOAD_MAX_PER_ITEM_BYTES = 100 * 1024 * 1024;
/** All uploads together: past it, uploads are refused (507) and the Developer is emailed. */
export const UPLOADS_MAX_TOTAL_BYTES = 10 * 1024 * 1024 * 1024;

/** `POST /api/uploads` response: path of the file, relative to the app URL (`/uploads/<name>`). */
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
   * `comment.created`: a new comment; `item.updated`: a Client priority or Échéance change (`from` → `to`);
   * `item.answered`: the Client answered a Task or Project at PR (`answer`). The changes an answer causes are not
   * Notifications of their own.
   */
  type: "comment.created" | "item.updated" | "item.answered";
  /** The Project or Task concerned (for a comment, the one it's on). */
  item_id: string;
  item_kind: "project" | "task";
  item_title: string;
  /** `comment.created`: id and current text of the comment. */
  comment_id?: string;
  body?: string;
  /** `item.updated`: the field changed and its old and new values. */
  field?: string;
  from?: unknown;
  to?: unknown;
  /** `item.answered`: the answer given. */
  answer?: ItemAnswer;
}

/**
 * An Inbox À trier entry: an item the Client or the Developer proposed that waits for Triage
 * (not Triaged yet, no Priority): Bug and Amélioration Tickets (triaged as a Task) and
 * launched Ideas (`type: "idea"`, triaged as a Project). It leaves
 * the list once triaged, so there is nothing to mark read.
 */
export interface InboxTicket {
  /** App id; becomes the `^id` of the Task line, or the `suivi_id:` of the Project file, written at Triage. */
  id: string;
  type: TaskType;
  title: string;
  /** Markdown. Uploaded files are `![](/uploads/<name>)` (images) or `[nom](/uploads/<name>)`, relative to the app URL. */
  description: string;
  /** ISO date-time. */
  created_at: string;
  author_email: string;
  /**
   * How much it gets in the Client's way, a Priority suggestion for Triage:
   * bloquant → P1, genant → P2, quand_possible → P3 (P0 stays the
   * Developer's choice). Null for an Idea and for Tickets sent before the
   * question existed.
   */
  urgency: TicketUrgency | null;
  /** The Project its author thinks it concerns (a suggestion; Triage decides). Null: « Je ne sais pas », or an Idea. */
  project_id: string | null;
}

/** Answers to « À quel point c'est gênant ? » on a Bug or Amélioration Ticket. */
export const TICKET_URGENCIES = ["bloquant", "genant", "quand_possible"] as const;
export type TicketUrgency = (typeof TICKET_URGENCIES)[number];

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
  /** The Project or Task concerned (for a comment, the one it's on); absent once archived. */
  item?: { kind: "project" | "task"; id: string; title: string };
  /**
   * Comment events: the comment; `body` absent once deleted. `mentions`:
   * handles of the users mentioned (see `Comment`); `mentioned`: the caller is
   * one of them.
   */
  comment?: { id: string; body?: string; mentions: string[]; mentioned: boolean };
  /** `item.updated`: the field changed and its old and new values. */
  field?: string;
  from?: unknown;
  to?: unknown;
  /** `item.answered`: the answer given. */
  answer?: ItemAnswer;
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
 * `POST /api/items/:id/triage` body: what an item not Triaged yet becomes.
 * `as: "task"` (Bug and Amélioration Tickets): a Task of `type` with
 * `priority` (0–5; PR is not offered) in Project `project_id` (null =
 * standalone), a Project step when `step` (then `priority` may be null =
 * inherit the Project's, no token on the line). `as: "project"` (launched
 * Ideas, "Nouveau projet"): a Project with `priority` (0–5), title and
 * description taken from the Idea, which then shows lancée.
 * Either way the item keeps its id, description and comments. `base`: the
 * Item's base as the vault will read the new line or file back, stored with
 * the Triage. 404 for an unknown item, 409 for one not À trier or not of that
 * kind, 400 for a bad body.
 */
export type TriageRequest =
  | {
      as: "task";
      type: TriageTaskType;
      step: boolean;
      priority: number | null;
      project_id: string | null;
      base?: ItemBase;
    }
  | {
      as: "project";
      priority: number;
      base?: ItemBase;
    };

/**
 * `POST /api/items/:id/triage` response: the item's shared fields now, i.e.
 * what the vault writes (the Task line, or the new Project file).
 */
export type TriageResponse =
  | { id: string; as: "task"; fields: TaskFields }
  | { id: string; as: "project"; fields: ProjectFields };

/**
 * The Answer an Item's current Priority or Done comes from, until the Pull
 * acknowledges it (`AcknowledgedItem.answer`): Validé made it done, À
 * reprendre put it at priority 0. What it set is in the Item's current fields.
 */
export interface StateAnswer {
  /** Id of the `item.answered` event. */
  id: number;
  answer: ItemAnswer;
  /** ISO date-time. */
  at: string;
  /** The `@handle` of the Client who answered, null while none is set. */
  by: string | null;
}

/** What every Item of `GET /api/state` carries besides its kind and fields. */
interface ItemStateCommon {
  id: string;
  /** Null: the plugin never wrote one; it takes the current fields as the base. */
  base: ItemBase | null;
  archived: boolean;
  /**
   * Triaged or pushed: a vault note should carry it. False for a Ticket or an
   * Idea not Triaged yet (still in the Demandes, or in the Inbox's to_triage).
   */
  triaged: boolean;
  /** Null when the Priority or Done doesn't come from an Answer, or that Answer was acknowledged. */
  answer: StateAnswer | null;
  /**
   * The `@handle` of the Client whose site change (drag or picker) set the
   * current priority, for the conflict buttons; null when a Push or Triage
   * set it, or no handle is set.
   */
  priority_by: string | null;
}

/**
 * A Task's fields as the app holds them: `type` may be one only the app sets
 * (a Ticket's `amelioration`); `done_on` is the `YYYY-MM-DD` (UTC) of its
 * done date, null when not done.
 */
export type TaskStateFields = Omit<TaskFields, "type" | "done_on"> & {
  type: TaskType;
  done_on: string | null;
};

/** One Item of `GET /api/state`. A launched Idea is its Project; its Idea row is not listed. */
export type ItemState =
  | (ItemStateCommon & {
      kind: "project";
      fields: ProjectFields;
      /**
       * The `@handle` of whoever set the current `due_date` on the site (a clear included), for the
       * conflict buttons; null when a Push set it, or no handle is set.
       */
      due_date_by: string | null;
    })
  | (ItemStateCommon & { kind: "task"; fields: TaskStateFields });

/** `GET /api/state` response (the Pull): every Project and Task, archived ones included. */
export interface StateResponse {
  items: ItemState[];
}

/**
 * An Item whose base the plugin sets: after the Pull wrote an app value into
 * the vault, or a conflict pick. `answer`: id of the Answer it wrote, which
 * `GET /api/state` then stops returning.
 */
export interface AcknowledgedItem {
  id: string;
  base: ItemBase;
  answer?: number;
}

/**
 * `POST /api/state/acknowledge` body. All or nothing: an unknown id is a 404,
 * a bad entry a 400, and no base is written.
 */
export interface AcknowledgeRequest {
  items: AcknowledgedItem[];
}

/** `POST /api/state/acknowledge` response. */
export interface AcknowledgeResponse {
  ok: true;
}
