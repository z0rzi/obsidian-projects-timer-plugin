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
- **Push to Suivi** — Review pending Project changes (new / changed old → new / deleted) and send the ticked ones to the Client app.

## Settings

- **Projects location** — Folder that contains project files.
- **Project template** — Template file for new projects.
- **Tasks kanban file** — Optional kanban source file.
- **Hours per day / Days per week** — Your expected schedule.
- **Hourly rate** — For revenue estimates in the status bar.
- **Suivi URL / Suivi API token** — The Client app to push to, and a personal API token created on its Paramètres page.

## Network use

The plugin makes network requests only to the Suivi URL you set, and only when you run **Push to Suivi**. It sends, for each note directly in the projects folder not marked `prive: true`: the file name (title), the `# Description` section, `status:` and `priority:` (P5 if missing). Time logs, other sections and other notes are never sent. The app's id is written back as `suivi_id:` in the Project's frontmatter. Sync state (what was last pushed) is kept in the plugin's `data.json` under `sync`.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # production build
```

## License

0-BSD
