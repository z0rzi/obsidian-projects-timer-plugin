# Projects Timer

An [Obsidian](https://obsidian.md) plugin to track time and manage projects and tasks.

## Features

- **Project tracking** — Use `\`\`\`project` code blocks to define time sources and log activities per project.
- **Task management** — Tag lines with `#task`, `#bug`, `#quick`, `#wait` or `#idea` to surface them in the Kanban board.
- **Kanban board** — Visualize and manage tasks by Priority: À valider, doing, a « rapides » column (the `#quick` lines without token, oldest note first, not draggable), P1 to P5; work at `pz` (the Client app's Frigo) is not shown, and a « Zzz » button on a card writes `pz`.
- **Time tracking** — Log activities with duration; see progress bars and totals per project.
- **Status bar** — Quick view of today's/weekly worked time and estimated revenue (last 30 days).
- **Activities list** — Review recent logged work across all projects.

## Usage

### Project block

In any markdown file, add:

\`\`\`project
[[Contract A]]; 40h; draft
[[Contract B]]; 20h; done
---
2025-05-20; 120; Initial setup
2025-05-21; 60; Review feedback
\`\`\`

- **Sources** (above `---`): linked notes or labels with estimated time and optional status.
- **Activities** (below `---`): `date; duration_in_minutes; description`.

### Task tags

In any note, write:

```
#task p2 Write the report
#bug Fix the login error
#quick Align the export button
#wait Waiting for client feedback
#idea pz A map of the sites
```

The token after the tag is the Priority: `p0`–`p5`, `pr` (À valider) or `pz` (hibernating, in the Client app's Frigo). Without one, a `#quick` line is Rapide (never ranked: `pz`, or `pr` while it waits for the Client's Answer, are the only tokens it takes) and any other line P1.

A Task belongs to a project by the first link to a project note on its line (`#bug p1 Legend overlaps [[Algorithme Turpe]]`), else by a link alone on the first line of its body, else by its note: the `project` frontmatter link, or the project note itself. A link deeper in the body is only a mention; two different projects named on one Task is an error the Push review shows on that line.

## Commands

- **Open Tasks Kanban** — Open the Kanban board.
- **Open Projects List** — Browse all project files.
- **Open Activities** — View recent logged activities.
- **Push to Suivi** — Review what the vault changed since it last agreed with the Client app (new, restored, changed old → new, conflicts, and lines to fix in the note), under the app's host, and send the ticked ones. Never-pushed done lines without a date are a collapsed group « Terminées sans date ».
- **Pull from Suivi** — Compare every Item's state in the app with the vault now and write the Client's changes (priorities, Project Échéances, Answers on Tasks and Projects) into the vault; a field changed on both sides since they last agreed becomes a conflict, settled at once by its buttons (`[ P0 (moi) ]  [ P1 (jmj) ]`, or for an Échéance `[ mars 2027 (moi) ]  [ Aucune (jmj) ]`) in the inbox or in **Push to Suivi**. Also runs on startup and every 5 minutes.
- **Open Suivi comments** — Side panel with the Client app comment thread of the pushed Task or Project under the cursor; reply, edit or delete your own comments there.
- **Trier les tickets** — Opens the Deck (below).
- **Lancer en projet** — On an `#idea` line: creates the project note from the project template with the line's Suivi id, title, Priority and body as its description, turns the Idea into that Project in the app (same id, comments and history), removes the line and opens the note.
- **Open Suivi inbox** — What needs you: « Trier (n) », the Tickets to triage, opening the Deck (« Trier » without any, for the Sweep); the Frigo count in the header; app Items no readable note carries (« Hors du vault »: « Insérer ici » or « Retirer de l'app », from 5 of them one entry opening a modal), conflicts, then the Client's unread entries; « Lu » or opening an entry (which jumps to its line, and its thread for a comment) takes it out; empty, it says « Rien à traiter ». Its header has Push and Pull buttons (the same as the commands) and a toggle that switches to the Activity: every event of the app, newest first, your own Pushes as one line each, read entries dimmed, "Charger plus" for older pages; comments that mention you stand out. After each Pull the inbox reloads and each Client entry new since the previous reload shows a toast (none at startup; a Ticket you created in the app is counted in « Trier (n) » without one; a Lot financement the Client launched is one toast); the status bar shows the unread count; kanban cards with unread entries get a badge ("💬 2 · P1→P2", "📅 mars 2027" or "📅 retirée" for an Échéance change) that opens the inbox filtered to that item.

## Settings

- **Projects location** — Folder that contains project files: a note directly in it is a project note, which a Task's link attaches it to.
- **Project template** — Template file for new projects (« Lancer en projet »).
- **Tasks kanban file** — Optional kanban source file.
- **Triage daily note template** — The file today's daily note is created from when Triage writes into it and it doesn't exist yet; empty for an empty note. The daily note's folder and name come from the core Daily notes settings.
- **Triage heading** — The heading of the daily note Triage writes its Tasks under, at the end of its section (default `## Triage`), added at the end of the note when missing.
- **Sweep age (days)** — How old a daily note is before the Sweep offers its Tasks, and how long Enter keeps one (default 7).
- **Hours per day / Days per week** — Your expected schedule.
- **Hourly rate** — For revenue estimates in the status bar.
- **Suivi URL / Suivi API token** — The Client app to push to, and a personal API token created on its Paramètres page.
- **Se déconnecter de l'app Client** — After a confirmation giving the counts, removes the app ids from the notes (`suivi_id:`, `^id` in the app's format) and clears the URL and token. Nothing is deleted in the app, and it is never called.

## Network use

The plugin makes network requests only to the Suivi URL you set, once it and the API token are set:

- **Pull**: on startup, every 5 minutes and with **Pull from Suivi**, it fetches the state of every Item (`GET /api/state`), writes the Client's priority and Échéance changes and Answers into your notes and acknowledges what it wrote (`POST /api/state/acknowledge`). A conflict's button pushes your value (`POST /api/push`) or writes the app's and acknowledges it.
- **Inbox**: after each Pull, and after a Deck session, it fetches the items to triage (`GET /api/inbox`) and the first page of the activity feed (`GET /api/activity`, 30 days); "Charger plus" fetches the page before. Marking entries read sends their event ids, or with "Tout marquer comme lu" the id of the newest loaded entry.
- **Push to Suivi**: only when you run it: it fetches the state of every Item (`GET /api/state`), then sends the changes you ticked (details below).
- **Comments panel**: only while it is open (details below).
- **The Deck** (« Trier (n) », « Trier » when no Ticket waits, or **Trier les tickets**): it reads the state (`GET /api/state`: the Zones for the picker, `kept_until` per Task, and when the Deck last wrote) and the items to triage. One item at a time, every choice on a key, the legend on screen: `j`/`k` field, `h`/`l` value, `b` `q` `t` `w` `i` type (`q` is Rapide too), `0`–`5` and `z` Priority, `p` Project and `o` Zone pickers, Enter write and next, `.` the previous Ticket's choices, `s` skip, `x` archive with an optional comment, `u` back to the previous card. The keys only record each card's decision: nothing goes to the app or into a note while deciding. `u` goes back card by card to the first, the card showing its decision (its line, its archive comment, skipped, or the Sweep's choice), and deciding again replaces it; from the first Ticket it goes back to the Sweep list on its last decision, and on the list to the previous decision. After the last card the end screen lists the decisions: the Tickets one row each (type, title, Priority, what will happen), the Sweep's lines grouped by outcome (au frigo, gardées, déplacées); `j`/`k` move, Enter on a row reopens its card, `u` goes back, and Enter on « Tout écrire (n) », focused by default, writes them all in the session's order. While writing, each row shows « Envoi… » then its result: ✓, ⓘ in blue for a Ticket no longer to triage, ✕ in red with the error (the Sweep's in French: « ligne introuvable dans la note »); then the closing Push's result. A card that fails is left undone (still to triage, or its line where it was) and the others go on; the report offers « Fermer » and, after failures, « Réessayer les échecs », which writes the failed cards only. With nothing to triage the Deck says « Rien à trier » with a « Fermer » button. Escape, or closing the Deck's tab, with decisions recorded asks « Abandonner n décisions ? »: yes writes nothing, « Reprendre » goes back to the session (kept in memory only, not across restarts); opening the Deck again shows a session with decisions as it is. A Ticket opens on the line the Client's answers propose (Bloquant `p0`; Gênant: a bug `pz`, a Retouche Rapide, anything else the Priority the Client chose, `p2` without one; Pour plus tard and a Nouveau chantier `pz`; no answer `p3`; his Project and Zone). Written, a line triages its Ticket (`POST /api/items/:id/triage`: type, Priority, Project, Zone and the base of the line) and writes the line into today's daily note under the Triage heading, its description as the body (images downloaded into the vault) and the Project as a link on the body's first line; a Ticket the Client withdrew or edited meanwhile is skipped with a message. An archive goes to `POST /api/items/:id/archiver`. **The Sweep** opens the day's first session, as one list before the Tickets: the Tag tasks of daily notes older than the sweep age, open, not at `pz`, `p0` or `p1`, not kept, lines not pushed yet included, grouped by note, oldest first, each note's header with « ↗ ouvrir » (the note in a split, the Deck stays). Each row shows the line's type, title, Priority, age (a bar full at 30 days and « 27 j ») and its decision; « ⚠ non poussée » marks a line not pushed yet. `j`/`k` move between rows; the focused row opens in its note (the heading above it, three faded lines on each side, the line and its body). `z` sends the line to the Frigo (`pz` written on it), `m` moves the line and its body into a project note's Tasks section as a step, Enter keeps it (`POST /api/items/:id/garder`, no line change; a line not pushed yet can't be kept, Enter says so), each written with the rest of the session, then the focus goes to the next undecided row; a line no longer in its note takes no key. The last row, « → Continuer vers les tickets (n) » (« → Fin » without Tickets), focused once every row has a decision, goes on with Enter; rows left undecided are not written. Once the session is written, a Push without review sends what the Sweep wrote, creating the lines not pushed yet; its result ends the report.
- **Hors du vault** in the Inbox: « Insérer ici » writes an Item no note carries with its id at the cursor and sends its base (`POST /api/state/acknowledge`); « Retirer de l'app » archives it (`POST /api/push`).
- **Lancer en projet**: sends the new project note's fields and base (`POST /api/items/:id/lancer`) before writing the note.

Push sends, for each note directly in the projects folder not marked `prive: true`: the file name (title), the `# Description` section, its Priority (`priority: 0`–`5`, `priority: pr`, in any case, for « À valider », waiting for the Client's Answer, or `priority: pz` for the Frigo; P5 if missing; any other value skips that Project with a Notice), Done (`archived: true`, then no Priority; back to `false` or removed reopens it with its Priority) and `due_date:`, the Échéance, a month (`due_date: 2027-01`; absent, empty, `null` or `~` for none; any other value, a full day included, skips that Project with a Notice naming the note). A `status:` key on a Project note is ignored. The Pull writes an Answer as `archived: true` (Validé) or `priority: 0` (À reprendre). The Pull writes `due_date:` when the Client sets or changes it and removes the key when he clears it. Time logs, other sections and other notes are never sent. A new Project gets an id in the app's format, written as `suivi_id:` in its frontmatter before it is sent.

It also sends Tasks with their body (the indented lines below the Task line, up to the next line at indent zero, de-indented; `![[...]]` images uploaded (PNG, JPEG, GIF, WebP, 25 MB max; the app recognises an image it already has and returns its URL) and other wikilinks sent as plain text): Tag task lines (`#task`, `#bug`, `#quick`, `#wait`, `#idea`, `#done`) in any note, and the top-level checkboxes under a shared Project's Tasks heading, minus lines carrying `#private` and the Tasks of `prive` Projects. A Task linked to a Project note marked `archived: true` that was never pushed (no `suivi_id:`) is refused on its line, « lié à un projet archivé jamais envoyé : <Project> », until you remove the link or un-archive the Project (the Push then creates it); that Project's steps are not sent. Sent: the title, type, Priority (the `p0`–`p5`, `pr` or `pz` token; none on a step inherits its Project's, none on a `#quick` Tag task is Rapide, none on another Tag task P1) or Done, Project, done date (`#done <date>`, or the date opening a done step's text once its type tag, wherever it sits, is out), whether it is a Project step, and the body. Lines never pushed and done more than 30 days ago are left out; undated done lines are listed apart (« Terminées sans date », unticked at a first Push) and get today's date when pushed. A new Task gets an id written as a `^id` block ID at the end of the line before it is sent; a line ending with another block ID is not pushed. Each change carries its base (the fields as the vault reads them), which the app keeps: nothing about what was pushed is kept in `data.json`. The Pull writes a Task's Answer as `#done <date>` (a step ticked with the date) for Validé, `p0` for À reprendre, or no token on a `#quick` Tag task, back to Rapide (`pq`).

The comments panel fetches the thread of the item under the cursor (identified by its `^id` or `suivi_id:` only), the images uploaded in it (with your token; shown from memory, never saved), and sends the replies and edits you type in it. Comments are never written into your notes.

The inbox's read state is kept by the app, not in the vault.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # production build
```

## License

0-BSD
