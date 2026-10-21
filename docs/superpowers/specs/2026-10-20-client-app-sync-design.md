# Client app sync — plugin design

Date: 2026-10-20
Status: agreed, not started

## Goal

Move client communication with JMJ from meetings to async. JMJ follows Projects and Tasks in the Client app ("Suivi de projets", repo `edf-suivi`): he comments, reprioritises, creates Tickets and gives his Answer on Tasks and Projects À valider. I handle almost everything from Obsidian.

This spec covers the vault side. The Client app, its API contract and the milestones are in `edf-suivi/docs/spec.md`; terms are defined in `edf-suivi/GLOSSARY.md`.

## Ownership

- The Client app is the source of truth for **shared fields**. The vault mirrors them and keeps everything else private.
- The plugin talks to the app through a `Remote` interface (below), configured with the app URL and a personal API token in plugin settings. `data.json` is git-ignored by both the vault and this repo.
- Sync state (last Pull cursor, last-pushed snapshot) lives in plugin data. One machine only for now.

## What is shared

Never shared: time logs (`project` blocks), billing, quotes, commands, knowledge, people.

### Projects

- Every project in `2.projects/`, unless frontmatter has `prive: true`.
- Shared fields: title, the `# Description` section, `status:`, `priority:`.
- `status:` frontmatter (new): `À faire` / `En cours` / `En pause` / `À valider` / `Terminé`. `archived: true` = `Terminé`. Independent of priority.
- Identity: `suivi_id:` frontmatter, written at first Push.

### Tasks

The line and its indented body are shared: the body (lines after the Task line with an indent above zero, blank lines included while the next non-blank line is indented) becomes the Task's Description, de-indented and shared through `shareBody` (`src/sync/sharedBody.ts`): `![[image]]` embeds uploaded and rewritten, other embeds and `[[wikilinks]]` to plain text, code kept as written. A Loom or Cap URL alone on a body line plays as a Video in the app. `#private` on the line hides the Task and its body.

**Tag tasks** — any line starting with a type tag, in any file, unless it carries `#private`. Project comes from the file (project file, or `project:` frontmatter of a meeting note); none = standalone Task.

| Tag | Client label |
|---|---|
| `#task` | Tâche |
| `#bug` | Bug |
| `#quick` | Tâche rapide |
| `#wait` | En attente (my title says what I'm waiting for) |

`#ask` and `#project` are removed.

**Project steps** — top-level `- [ ]` lines under the `Tasks` heading (existing `findTasksHeadingSection` logic, unchanged; rename the one `# Tâches` heading). A step is a flag on the Task, not a type: it carries a type tag first, then the status token, like a Tag task (`- [ ] #bug p2 Title ^id`); no tag = `task`. The Client recognises a step by its Project badge and the "x/y étapes" count. Steps inherit the Project's priority unless they carry a token (an Override). A `#wait` step shows in En attente like a `#wait` Tag task.

**Status token** — first word after the marker, lowercase only, whole word:

```
#task p2 Nouveau widget saison ^t7f3a
- [ ] p1 fix the x axis of the heatmap ^t91c2
- [ ] #bug p2 Legend overlaps the curve ^t5d10
- [ ] pr Export CSV ^t04be
```

| Token | Status |
|---|---|
| `p0` | En cours |
| `p1`–`p5` | À faire, at that priority |
| `pr` | À valider |
| `#done <date>` / `[x]` | Terminé |
| (none, Project step) | À faire, inherits Project priority |

`À trier` exists only in the app and in the Obsidian Inbox, never in the vault.

**Stable IDs** — `^<id>` block ID at the end of the line, assigned by the app at first Push (or at Triage) and stripped from the title by the parser. All write-backs locate the line by ID, not line number. Moving a line between files is a move, not a delete.

## Permissions (enforced by the app)

- **JMJ:** Project and Task priority within P1–P5, comments, Tickets (bug / amélioration / idée), the Answer (Validé / À reprendre) on a Task or Project À valider, "Je veux lancer" on an Idea.
- **Me only:** moving anything to or from P0 (JMJ sees P0 but can't set it; for urgency he uses P1 + a comment), status (except through the Answer), titles, moves, deletions.
- JMJ changing the priority of an inheriting Project step makes the Pull write an Override token on the line.
- The Pull writes the Answer back: Validé makes a Tag task `#done <date>`, ticks a Project step and sets `archived: true` on a Project; À reprendre gives a Task the `p0` token and a Project `status: en cours`. When I changed that status locally since the last Push, it becomes a `status` conflict.
- Every Client change lands in my Inbox.

## Push and Pull

- **Pull:** on startup, every 5 min, on command (`GET /api/events?since=`). Never overwrites a field I edited locally and haven't pushed; that becomes a conflict shown in the Push screen. Untouched fields update silently.
- **Push:** on demand only (meeting Tasks get reorganised before sending). Opens a modal listing pending changes grouped *new / changed (old → new) / deleted / conflicts*, one checkbox each, all ticked by default. Unpushed items do not exist for JMJ.
- **Delete** in the vault = archive in the app, only on Push.
- **First Push:** open items + items done in the last 30 days. Older history and archived Projects stay vault-only.
- Project steps have no done date: the app uses the Push date.

## Inbox (Obsidian view)

One panel, reload icon at the top:

- **À trier**, pinned on top: new bug / amélioration Tickets and Ideas JMJ launched. **Insérer ici** writes the Task at the cursor (type and priority picked in a dialog): a Tag task `#<type> p<n> <title> ^<id>`, or, when the cursor is on a Project note's Tasks heading or in its section, a Project step `- [ ] #<type> p<n> <title> ^<id>` whose priority defaults to "hériter du projet" (no token). The Ticket's Description goes under the line as its body, indented with one tab, blank lines kept. Images JMJ pasted are downloaded with the token into the note's attachment folder and embedded as `![[…]]`; their app URL is recorded (`appImages` in the sync state), so a later Push reuses it instead of uploading the image again while the file keeps its size. An image that can't be downloaded keeps its app link, with a notice. The line and body are recorded as last pushed, so the next Push shows no change. **Nouveau projet** creates a Project file from the template with its `suivi_id:`. The app item stays the same, so JMJ's description and comments stay attached.
- **Conflits**, pinned while there are Pull conflicts; they are settled in Push.
- **The feed** (`GET /api/activity`): every event of the log, newest first, grouped by day, the events of my own Pushes collapsed to one line per Push ("Push : 12 changements"). Filter Tous / JMJ / Moi. Comment entries show the full body rendered as markdown, known `@handle`s highlighted; a comment that mentions me (`@baptiste`) stands out. Clicking an entry opens the file at the line and, for comments, the thread panel. The last 30 days are loaded; "Charger plus" pages further back.
- **Read rule**: an entry is unread when JMJ wrote it and I haven't marked it read; my own site actions and Push lines never are. Reading is deliberate: "Lu" per entry, "Tout marquer comme lu" for every Client event up to the newest loaded. Opening an entry or a thread marks nothing.

Signals, from the loaded entries:

- after a Pull that brought Client events, one toast per event ("JMJ a commenté Algo détection", "P1 → P2 sur Prix SPOTS");
- a status bar item with the unread count, opening the Inbox;
- on kanban cards with unread entries, a badge at the top right ("💬 2 · P1→P2") and a tinted background; clicking the badge opens the Inbox filtered to that item ("<titre> ✕" clears the filter).

New Ideas do not reach À trier: they stay in the app's Idées list until JMJ launches one.

## Other plugin changes

- **Comment side panel:** thread of the Task/Project under the cursor (on its line or in its body), reply, edit or delete own comments from there. Comments are never written into markdown.
- **Kanban:** `À valider` column (`pr`), the unread badge above, one colour per type (bug red `#b82626`, quick yellow `#f7d522`, task grey, wait faded and dashed) as the card border, a small label in that colour before the title ("BUG", "RAPIDE", "ATTENTE"; none for task) and a dot of that colour in front of each step line on a Project card, Overridden Project steps greyed on their Project card and shown as their own card in the right priority column.
- **Parser:** `quick` stays, `project` type removed, token matched as lowercase whole first word (today `/p\d/i` matches anywhere, e.g. `Étape2`), block ID stripped from title, writes by ID instead of line number (today `updateTaskTag` overwrites `lines[task.line]` blindly).

## Remote interface

```ts
interface Remote {
	push(changes: PushChange[]): Promise<PushResult[]>;
	pull(cursor: number | null): Promise<EventsResponse>;
	comments(itemId: string): Promise<Comment[]>;
	comment(itemId: string, body: string): Promise<Comment>;
	editComment(commentId: string, body: string | null): Promise<void>; // null = delete
	inbox(): Promise<InboxResponse>; // items À trier
	activity(before?: number, days?: number): Promise<ActivityResponse>; // a page of the feed
	markRead(eventIds: number[]): Promise<void>;
	markReadUpTo(id: number): Promise<void>; // every Client event up to id
	upload(data: ArrayBuffer, name: string): Promise<string>; // returns URL
	image(path: string): Promise<{ data: ArrayBuffer; type: string }>;
	triage(itemId: string, as: TriageRequest): Promise<TriageResponse>;
}
```

The only implementation is the `edf-suivi` HTTP API; types are copied from `edf-suivi` (it owns the contract). Parser, kanban, Inbox and Push screen depend only on this interface.
