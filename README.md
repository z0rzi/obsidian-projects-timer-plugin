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
- **Push to Suivi** — Review pending Project and Task changes (new / changed old → new / deleted) and send the ticked ones to the Client app.
- **Pull from Suivi** — Fetch the Client's changes now (priorities, Answers on Tasks and Projects) and write them into the vault; a field you changed locally and haven't pushed becomes a conflict to settle in **Push to Suivi**. Also runs on startup and every 5 minutes.
- **Open Suivi comments** — Side panel with the Client app comment thread of the pushed Task or Project under the cursor; reply, edit or delete your own comments there.
- **Open Suivi inbox** — Items to triage and Pull conflicts pinned on top, then the activity feed, newest first: every event of the app, your own Pushes as one line each, filtered Tous / JMJ / Moi, "Charger plus" for older pages; comments that mention you stand out. The Client's entries stay unread until you click "Lu" or "Tout marquer comme lu"; opening an entry jumps to its line (and its thread for a comment) without marking it read. After a Pull, each new Client event shows a toast; the status bar shows the unread count; kanban cards with unread entries get a badge ("💬 2 · P1→P2") that opens the inbox filtered to that item.

## Settings

- **Projects location** — Folder that contains project files.
- **Project template** — Template file for new projects.
- **Tasks kanban file** — Optional kanban source file.
- **Hours per day / Days per week** — Your expected schedule.
- **Hourly rate** — For revenue estimates in the status bar.
- **Suivi URL / Suivi API token** — The Client app to push to, and a personal API token created on its Paramètres page.

## Network use

The plugin makes network requests only to the Suivi URL you set, once it and the API token are set:

- **Pull**: on startup, every 5 minutes and with **Pull from Suivi**, it fetches the app's new events (`GET /api/events`) and writes the Client's priority changes and Answers into your notes.
- **Inbox**: after the startup Pull, after each Pull that brought events, after a triage and with its reload button, it fetches the items to triage (`GET /api/inbox`) and the first page of the activity feed (`GET /api/activity`, 30 days); "Charger plus" fetches the page before. Marking entries read sends their event ids, or with "Tout marquer comme lu" the id of the newest loaded entry.
- **Push to Suivi**: only when you run it (details below).
- **Comments panel**: only while it is open (details below).
- **Triage** from the Inbox ("Insérer ici", "Nouveau projet"): sends the type, priority (or inherit, for a Project step) and Project you picked, and whether the line is a Project step.

Push sends, for each note directly in the projects folder not marked `prive: true`: the file name (title), the `# Description` section, `status:` and `priority:` (P5 if missing). Time logs, other sections and other notes are never sent. The app's id is written back as `suivi_id:` in the Project's frontmatter.

It also sends Tasks with their body (the indented lines below the Task line, up to the next line at indent zero, de-indented; `![[...]]` images uploaded (PNG, JPEG, GIF, WebP, 10 MB max) and other wikilinks sent as plain text): Tag task lines (`#task`, `#bug`, `#quick`, `#wait`, `#done`) in any note, and the top-level checkboxes under a shared Project's Tasks heading, minus lines carrying `#private` and the Tasks of `prive` Projects. Sent: the title, type, status token, Project, `#done` date, whether it is a Project step, and the body. A first Push leaves out items done more than 30 days ago (and undated done lines). The app's id is written back as a `^id` block ID at the end of the line. Sync state (what was last pushed) is kept in the plugin's `data.json` under `sync`.

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
