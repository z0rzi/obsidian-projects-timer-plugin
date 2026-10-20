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

/** One vault change in a Push. Items are addressed by the id the app gave them at creation. */
export type PushChange =
  | { op: "create"; kind: "project"; fields: ProjectFields }
  | { op: "update"; kind: "project"; id: string; fields: Partial<ProjectFields> }
  | { op: "archive"; kind: "project"; id: string };

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
