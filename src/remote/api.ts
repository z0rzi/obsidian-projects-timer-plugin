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
 * Answer), `"pz"` is PZ (« En hibernation »: kept, in the Frigo, off both
 * boards), `"pq"` is Rapide (a `quick` Tag task, never ranked). There is no
 * status besides it: work is open at a Priority, or Done. Projects take every
 * one but `pq`; a `quick` Tag task (not a step) takes only `pq` or `pz`, and
 * only it takes `pq`. Steps without their own inherit their Project's, PZ
 * included. The order is the ranking order.
 */
export const PRIORITIES = [0, 1, 2, 3, 4, 5, "pr", "pz", "pq"] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * The Priorities but Rapide, which is never picked as a rank: it comes with
 * the `quick` type (the Deck's Rapide sets both). The item page's picker
 * narrows them to 1–5.
 */
export const PICKED_PRIORITIES = PRIORITIES.filter((p): p is Exclude<Priority, "pq"> => p !== "pq");

/**
 * The Priorities a Triage request may set: all but PR, which is the
 * Developer's to set later, by Push; `pq` only with the type `quick`.
 */
export const TRIAGE_PRIORITIES = PRIORITIES.filter((p): p is Exclude<Priority, "pr"> => p !== "pr");
export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number];

/**
 * Fields of a Project the Developer sets by Push. Vault mapping: `priority:
 * 0`–`5`, `priority: pr` or `priority: pz` (never `pq`); `archived: true` = `done` (Livré). The `status:`
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
 * Idée. A Ticket is `bug`, `quick`, `task` or `idea` (Nouvelle demande's Bug, Retouche visuelle, Ajout ou
 * modification métier, Nouveau chantier). Events written before may carry `amelioration` (now `task`). A
 * Project step is not a type but the `step` flag: a step has a type like any Task.
 */
export const TASK_TYPES = ["task", "bug", "quick", "wait", "idea"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
/** Types a Push may set: the vault's tags (`#task`, `#bug`, `#quick`, `#wait`, `#idea`); no tag = `task`. */
export const PUSHED_TASK_TYPES = ["task", "bug", "quick", "wait", "idea"] as const;
export type PushedTaskType = (typeof PUSHED_TASK_TYPES)[number];

/**
 * Fields of a Task the Developer sets by Push: the line and its body.
 * Vault mapping: the token `p0`–`p5`, `pr` or `pz` = `priority`; no token is
 * `pq` on a `#quick` Tag task, P1 on any other Tag task and null (inherit) on
 * a Project step. `[x]` / `#done <date>` = `done` (Terminé).
 */
export interface TaskFields {
  title: string;
  type: PushedTaskType;
  /**
   * The Task's Description: its vault body, de-indented, shared with images
   * uploaded and wikilinks turned to text, without a first line that is a bare
   * link to a Project note (that line is the Project link). A Push may omit it
   * on create (`""`).
   */
  description: string;
  /**
   * Null = inherit the Project's Priority, PR and PZ included (a Project
   * step without token). Null once Done: Done work has no Priority, and one
   * pushed with Done is not kept. An open Task outside any Project
   * (`project_id` null) has one: a Push creating, reopening or moving it out
   * of its Project sends one, and can't clear it; a Task in a Project may
   * inherit. An open `quick` Tag task (`step` false) has `pq` or `pz`, in a
   * Project or not, and only it has `pq`: anything else is refused with « Une
   * tâche rapide n'a pas de priorité » (a `quick` step inherits like any step).
   */
  priority: Priority | null;
  /**
   * App id of the Project, null for a standalone Task. Vault: the first link
   * to a Project note on the line, else a bare link to one as the body's first
   * line, else the note's Project (its `project:` frontmatter, or the Project
   * note itself); two different Projects named is a Push error on the line.
   */
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
 * Payload of `item.answered` (the item is the Task or Project, which was at PR
 * by its own Priority: a step inheriting PR is never answered): the Client's
 * Answer and the comment given with it (required for `a_reprendre`, else null
 * when none). `valide` makes it done (vault: Task `#done <date>`, `[x]` for a
 * step; Project `archived: true`), its steps untouched; `a_reprendre` puts it
 * at priority 0 (vault: Task `p0`, Project `priority: 0`), a Rapide back at
 * Rapide (`pq`, vault: no token). The app emits those changes as
 * `item.updated` events (`done`, or `priority`) carrying
 * `answer: <id of the item.answered event>`, right after it.
 */
export interface ItemAnsweredPayload {
  answer: ItemAnswer;
  comment_id: string | null;
}

/**
 * An Item's base: its shared fields as the vault last agreed with the app, in
 * the vault's own form (the plugin's `{ path, fields }` record). The plugin
 * writes it (Push, Triage, « Lancer en projet », `POST /api/state/acknowledge`) and reads it back
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

/**
 * Event types of the log (docs/spec.md "Event types"). `idea.launched` is old
 * history only (the Ideas flow before Ideas were Tasks); « Lancer en projet »
 * writes `item.launched`.
 */
export const EVENT_TYPES = [
  "project.created",
  "task.created",
  "item.updated",
  "item.archived",
  "ticket.created",
  "idea.launched",
  "item.triaged",
  "item.launched",
  "item.answered",
  "comment.created",
  "comment.edited",
  "comment.deleted",
  "push.completed",
  "bundle.launched",
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
 * reopening the reverse with the `priority` the item comes back at. A move to
 * or from PZ or Rapide is a plain `priority` change. A Description change
 * carries no values: `handles` lists the Mention handles before and after
 * instead. A Task's Zone change is `{ field: "zone", from, to }` with Zone ids
 * (null = none) and `names`, the Zones' names at the time. A Lot financement
 * change is `{ field: "bundle", from, to }`, names or null. A change an Answer
 * caused carries `answer`, the id of its `item.answered` event; a change
 * « Lancer le lot » caused carries `bundle`, the id of its `bundle.launched`
 * event (`{ name, priority, item_ids }`, no item). A Task a Project took along
 * out of PZ (back to inheriting; not a Rapide, back to Rapide with a line of
 * its own) carries `project`, the id of the Project's own `item.updated`.
 */
export interface ItemUpdatedPayload {
  field: string;
  from?: unknown;
  to?: unknown;
  handles?: { from: string[]; to: string[] };
  /** Zone changes only: the names of the `from` and `to` Zones when it changed (null = none). */
  names?: { from: string | null; to: string | null };
  /** On reopening only: the Priority it comes back at (null for a Task inheriting its Project's). */
  priority?: Priority | null;
  /** A change an Answer caused: the id of its `item.answered` event. */
  answer?: number;
  /** A change « Lancer le lot » caused: the id of its `bundle.launched` event. */
  bundle?: number;
  /** A change a Project's move out of PZ caused on one of its Tasks: the id of the Project's own `item.updated`. */
  project?: number;
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
   * `item.answered`: the Client answered a Task or Project at PR (`answer`); `bundle.launched`: the Client launched
   * a Bundle (« Lot financement ») out of the Frigo (`bundle`). The changes an answer or a launch causes are not
   * Notifications of their own.
   */
  type: "comment.created" | "item.updated" | "item.answered" | "bundle.launched";
  /** The Project or Task concerned (for a comment, the one it's on); absent on `bundle.launched`, about several. */
  item_id?: string;
  item_kind?: "project" | "task";
  item_title?: string;
  /** `comment.created`: id and current text of the comment. */
  comment_id?: string;
  body?: string;
  /** `item.updated`: the field changed and its old and new values. */
  field?: string;
  from?: unknown;
  to?: unknown;
  /** `item.answered`: the answer given. */
  answer?: ItemAnswer;
  /** `bundle.launched`: the Bundle's name, the Priority it was launched at, and the items it moved. */
  bundle?: { name: string; priority: Priority; item_ids: string[] };
}

/**
 * An Inbox À trier entry: an item the Client or the Developer proposed that waits for Triage
 * (not Triaged yet, no Priority): Tickets of any type, Nouveau chantier (`idea`) included, each triaged
 * as a Task.
 * `type`, `urgency`, `requested_priority`, `project_id` and `zone_id` are its author's answers, hints for Triage. It leaves
 * the list once triaged, so there is nothing to mark read.
 */
export interface InboxTicket {
  /** App id; becomes the `^id` of the Task line written at Triage. */
  id: string;
  /** Nouvelle demande's Bug (`bug`), Retouche visuelle (`quick`), Ajout ou modification métier (`task`), Nouveau chantier (`idea`). */
  type: TaskType;
  title: string;
  /** Markdown. Uploaded files are `![](/uploads/<name>)` (images) or `[nom](/uploads/<name>)`, relative to the app URL. */
  description: string;
  /** ISO date-time. */
  created_at: string;
  /**
   * ISO date-time of its latest change: its last event (its creation, its author's Modifier, a Zone change).
   * The Deck sends it back as `TriageRequest.expected`, so a Ticket edited meanwhile is not triaged unseen.
   */
  changed_at: string;
  author_email: string;
  /**
   * How much it gets in the Client's way (« À quel point ça gêne ? »), a Priority suggestion for Triage:
   * bloquant → P0; genant → PZ (the Frigo) for a bug unless the Developer judges it quick, Rapide for a
   * quick, `requested_priority` for a task (P2 when it has none); plus_tard → PZ. Null for a Nouveau
   * chantier and for Tickets sent before the question existed.
   */
  urgency: TicketUrgency | null;
  /**
   * The Priority its author chose (1 to 5, « Priorité » on Nouvelle demande), asked only of a Gênant
   * Ajout ou modification métier (`task`): a suggestion, Triage sets the real one. Null for any other
   * answer and for Tickets sent before the question existed.
   */
  requested_priority: RequestedPriority | null;
  /** The Project its author thinks it concerns (a suggestion; Triage decides). Null: « Je ne sais pas ». */
  project_id: string | null;
  /** The Zone its author thinks it is in (`Zone.id`, a suggestion; Triage decides). Null: « Je ne sais pas ». */
  zone_id: number | null;
}

/** Answers to « À quel point ça gêne ? » on a Ticket other than a Nouveau chantier: Bloquant, Gênant, Pour plus tard. */
export const TICKET_URGENCIES = ["bloquant", "genant", "plus_tard"] as const;
export type TicketUrgency = (typeof TICKET_URGENCIES)[number];

/** The Priorities a Gênant Ajout ou modification métier may ask for (`InboxTicket.requested_priority`): P1 to P5. */
export const REQUESTED_PRIORITIES = [1, 2, 3, 4, 5] as const;
export type RequestedPriority = (typeof REQUESTED_PRIORITIES)[number];

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
export const TRIAGE_TASK_TYPES = ["task", "bug", "quick", "wait", "idea"] as const;
export type TriageTaskType = (typeof TRIAGE_TASK_TYPES)[number];

/**
 * `POST /api/items/:id/triage` body: what an item not Triaged yet becomes,
 * always a Task (Tickets, a Nouveau chantier included): a Tag task of `type` with
 * `priority` (one of `TRIAGE_PRIORITIES`: 0–5, `pz`, or `pq` for a `quick`,
 * which takes only `pq` or `pz`) in Project `project_id` (null =
 * standalone); in a Project `priority` may be null = inherit the Project's.
 * `step` is ignored (sent by plugins before PZ; a Triaged Ticket is a Tag
 * task, written into the day's Daily note) and goes in the next version. An
 * Idea becomes a Project later, from its line (`LaunchRequest`). The item
 * keeps its id, description and comments. `zone_id`: the Task's Zone
 * (`Zone.id`), null for none; absent, the Zone it has stays (the author's
 * suggestion, `InboxTicket.zone_id`). `base`: the Item's base as the vault
 * will read the new line back, stored with the Triage. 404 for an unknown item, 409 for one not À trier, 400 for a
 * bad body.
 * `expected`: the `InboxTicket.changed_at` the Developer saw; 409 when the Ticket changed since (its author
 * edited it meanwhile). Absent, no check.
 */
export interface TriageRequest {
  as: "task";
  type: TriageTaskType;
  /** Ignored. */
  step?: boolean;
  priority: TriagePriority | null;
  project_id: string | null;
  zone_id?: number | null;
  base?: ItemBase;
  expected?: string;
}

/**
 * `POST /api/items/:id/triage` response: the item's shared fields now, i.e.
 * what the vault writes (the Task line).
 */
export interface TriageResponse {
  id: string;
  as: "task";
  fields: TaskFields;
}

/**
 * `POST /api/items/:id/archiver` body (« Archiver » in the Deck): an item À trier is archived, `comment`
 * (optional, blank = none) added to its thread first, as the Developer's. 404 for an unknown or archived item
 * (withdrawn by its author), 409 for one not À trier, 400 for a bad body.
 */
export interface ArchiveTicketRequest {
  comment?: string | null;
}

/** `POST /api/items/:id/archiver` response. */
export interface ArchiveTicketResponse {
  ok: true;
}

/**
 * `POST /api/items/:id/lancer` body (« Lancer en projet », ADR 0009): a
 * Triaged Task of type `idea` becomes a Project with the same id, its
 * comments and history kept. `fields` and `base` are those of the new Project
 * note, checked as a Push `create` of a Project checks them (`title`
 * required; `description` `""`, `done` false and `due_date` null when
 * absent; an open Project needs a Priority, never `pq`). The Task's row is
 * retired: `GET /api/state` then lists the item as that Project only. One
 * `item.launched { from: <the Task's TaskFields>, to: <ProjectFields> }`
 * event. 404 for an unknown or archived item, 409 for one that is not a
 * Triaged Task of type `idea`, 400 for a bad body.
 */
export interface LaunchRequest {
  fields: Partial<ProjectFields> & { title: string };
  base?: ItemBase;
}

/** `POST /api/items/:id/lancer` response: the Project's fields as stored. */
export interface LaunchResponse {
  id: string;
  fields: ProjectFields;
}

/**
 * `POST /api/items/:id/garder` body (Enter on a Sweep item): the Sweep skips the Task until `until`, a day
 * `YYYY-MM-DD` (today plus the sweep age), null to clear. Read back as `kept_until` in `GET /api/state`. No
 * event (like the base, ADR 0006). 404 for an unknown or archived item or a Project, 400 for a bad body.
 */
export interface KeepRequest {
  until: string | null;
}

/** `POST /api/items/:id/garder` response: the date as stored. */
export interface KeepResponse {
  id: string;
  kept_until: string | null;
}

/**
 * The Answer an Item's current Priority or Done comes from, until the Pull
 * acknowledges it (`AcknowledgedItem.answer`): Validé made it done, À
 * reprendre put it at priority 0 (a Rapide back at Rapide). What it set is in
 * the Item's current fields.
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
   * Triaged or pushed: a vault note should carry it. False for a Ticket not
   * Triaged yet (in the Inbox's to_triage).
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
 * A Task's fields as the app holds them: `done_on` is the `YYYY-MM-DD` (UTC)
 * of its done date, null when not done.
 */
export type TaskStateFields = Omit<TaskFields, "type" | "done_on"> & {
  type: TaskType;
  done_on: string | null;
};

/** One Item of `GET /api/state`. A launched Idea is its Project; its Task row is not listed. */
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
  | (ItemStateCommon & {
      kind: "task";
      fields: TaskStateFields;
      /**
       * The Sweep's snooze (`KeepRequest`): `YYYY-MM-DD` until which the Sweep skips the Task; null when never
       * kept or cleared. App-only, like the base: no event, not a field of the vault.
       */
      kept_until: string | null;
    });

/**
 * A Zone: a page of the Client's product, from the list the Developer keeps in the app's Paramètres. A Task
 * has at most one (`TriageRequest.zone_id`); Projects have none. Zones never go in the vault (ADR 0010).
 */
export interface Zone {
  id: number;
  name: string;
  /** Where the page is in the product, e.g. `/factures/export`; empty when not given. */
  path: string;
}

/**
 * `GET /api/state` response (the Pull): every Project and Task, archived ones included, the Zones in the
 * Developer's order, for the Zone pickers, and when the Deck last wrote, for the Sweep.
 */
export interface StateResponse {
  items: ItemState[];
  zones: Zone[];
  /**
   * ISO date-time of the Developer's latest Deck write: a Triage, an « Archiver » of a Ticket, or a keep
   * (`KeepRequest`); null when none. The Sweep runs in the first Deck session of the day: when this is not
   * today, no session wrote yet today.
   */
  deck_at: string | null;
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
