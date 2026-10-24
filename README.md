# Projects Timer

An [Obsidian](https://obsidian.md) plugin to track time and manage projects and tasks.

## Features

- **Project tracking** — Use `\`\`\`project` code blocks to define time sources and log activities per project.
- **Task management** — Tag lines with `#task`, `#bug`, `#now`, or `#wait` to surface them in the Kanban board.
- **Kanban board** — Visualize and manage tasks by type.
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
#now p1 Urgent review
#wait Waiting for client feedback
```

Tasks appear in the Kanban board and are linked to their project if the note has a `project` frontmatter key or contains a `\`\`\`project` block.

## Commands

- **Open Tasks Kanban** — Open the Kanban board.
- **Open Projects List** — Browse all project files.
- **Open Activities** — View recent logged activities.
- **Push to Suivi** — Review what the vault changed since it last agreed with the Client app (new, restored, changed old → new, conflicts, and lines to fix in the note), under the app's host, and send the ticked ones. Never-pushed done lines without a date are a collapsed group « Terminées sans date ».
- **Pull from Suivi** — Compare every Item's state in the app with the vault now and write the Client's changes (priorities, Project Échéances, Answers on Tasks and Projects) into the vault; a field changed on both sides since they last agreed becomes a conflict, settled at once by its buttons (`[ P0 (moi) ]  [ P1 (jmj) ]`, or for an Échéance `[ 1 mars 2027 (moi) ]  [ Aucune (jmj) ]`) in the inbox or in **Push to Suivi**. Also runs on startup and every 5 minutes.
- **Open Suivi comments** — Side panel with the Client app comment thread of the pushed Task or Project under the cursor; reply, edit or delete your own comments there.
- **Open Suivi inbox** — What needs you: items to triage (« À trier »), app Items no readable note carries (« Hors du vault »: « Insérer ici » or « Retirer de l'app », from 5 of them one entry opening a modal), conflicts, then the Client's unread entries; « Lu » or opening an entry (which jumps to its line, and its thread for a comment) takes it out; empty, it says « Rien à traiter ». Its header has Push and Pull buttons (the same as the commands) and a toggle that switches to the Activity: every event of the app, newest first, your own Pushes as one line each, read entries dimmed, "Charger plus" for older pages; comments that mention you stand out. After each Pull the inbox reloads and each Client entry new since the previous reload shows a toast (none at startup); the status bar shows the unread count; kanban cards with unread entries get a badge ("💬 2 · P1→P2", "📅 1 mars 2027" or "📅 retirée" for an Échéance change) that opens the inbox filtered to that item.

## Settings

- **Projects location** — Folder that contains project files.
- **Project template** — Template file for new projects.
- **Tasks kanban file** — Optional kanban source file.
- **Hours per day / Days per week** — Your expected schedule.
- **Hourly rate** — For revenue estimates in the status bar.
- **Suivi URL / Suivi API token** — The Client app to push to, and a personal API token created on its Paramètres page.
- **Se déconnecter de l'app Client** — After a confirmation giving the counts, removes the app ids from the notes (`suivi_id:`, `^id` in the app's format) and clears the URL and token. Nothing is deleted in the app, and it is never called.

## Network use

The plugin makes network requests only to the Suivi URL you set, once it and the API token are set:

- **Pull**: on startup, every 5 minutes and with **Pull from Suivi**, it fetches the state of every Item (`GET /api/state`), writes the Client's priority and Échéance changes and Answers into your notes and acknowledges what it wrote (`POST /api/state/acknowledge`). A conflict's button pushes your value (`POST /api/push`) or writes the app's and acknowledges it.
- **Inbox**: after each Pull, and after a triage, it fetches the items to triage (`GET /api/inbox`) and the first page of the activity feed (`GET /api/activity`, 30 days); "Charger plus" fetches the page before. Marking entries read sends their event ids, or with "Tout marquer comme lu" the id of the newest loaded entry.
- **Push to Suivi**: only when you run it: it fetches the state of every Item (`GET /api/state`), then sends the changes you ticked (details below).
- **Comments panel**: only while it is open (details below).
- **Triage** from the Inbox ("Insérer ici", "Nouveau projet"; a Ticket shows « Projet : <title> · <Urgency> », the title a link to the Project note when it is in the vault, and then also has « Insérer dans <Project> », which writes it as that Project's first step, right below its Tasks heading, and puts the cursor on it; a private Project gets no such button, a Project note without a Tasks heading a Notice and nothing is triaged): sends the type, priority (or inherit, for a Project step) and Project you picked, and whether the line is a Project step, then the base of what it wrote (`POST /api/state/acknowledge`). « Insérer ici » on an Item « Hors du vault » writes it with its id and sends its base the same way; « Retirer de l'app » archives it (`POST /api/push`).

Push sends, for each note directly in the projects folder not marked `prive: true`: the file name (title), the `# Description` section, `status:`, `priority:` (P5 if missing) and `due_date:`, the Échéance (`YYYY-MM-DD`; absent, empty, `null` or `~` for none; any other value skips that Project with a Notice naming the note, like an unknown status). The Pull writes `due_date:` when the Client sets or changes it and removes the key when he clears it. Time logs, other sections and other notes are never sent. A new Project gets an id in the app's format, written as `suivi_id:` in its frontmatter before it is sent.

It also sends Tasks with their body (the indented lines below the Task line, up to the next line at indent zero, de-indented; `![[...]]` images uploaded (PNG, JPEG, GIF, WebP, 25 MB max; the app recognises an image it already has and returns its URL) and other wikilinks sent as plain text): Tag task lines (`#task`, `#bug`, `#quick`, `#wait`, `#done`) in any note, and the top-level checkboxes under a shared Project's Tasks heading, minus lines carrying `#private` and the Tasks of `prive` Projects. Sent: the title, type, status token, Project, done date (`#done <date>`, or the date opening a done step's text once its type tag, wherever it sits, is out), whether it is a Project step, and the body. Lines never pushed and done more than 30 days ago are left out; undated done lines are listed apart (« Terminées sans date », unticked at a first Push) and get today's date when pushed. A new Task gets an id written as a `^id` block ID at the end of the line before it is sent; a line ending with another block ID is not pushed. Each change carries its base (the fields as the vault reads them), which the app keeps: nothing about what was pushed is kept in `data.json`.

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
