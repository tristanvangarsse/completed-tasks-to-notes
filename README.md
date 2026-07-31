# Completed Tasks to Notes

Convert checked tasks from a source note into individual Markdown notes with structured properties for Obsidian Bases, search, backlinks, and other query tools.

## What it does

When a task is checked, the plugin:

1. Finds the nearest heading and uses it as the task's `topic`.
2. Adds a completion date if the task does not already contain one.
3. Creates one Markdown note for the completed task.
4. Adds properties such as `topic`, `status`, `completed`, `type`, `heading-path`, and `source`.
5. Preserves the entire task block, including indented context and links.
6. Removes the original task only after the new note has been created and verified.

## Example

Source note:

```markdown
# Tasks

## Acme website redesign

- [x] Ask [[Maya Chen]] whether order NP-4821 can arrive before 2026-08-14
  - Why: the brochures are required for the launch event
  - Related: [[Acme launch plan]]
```

Generated note:

```markdown
---
topic: "Acme website redesign"
status: completed
completed: "2026-07-31"
type: task
heading-path: "Tasks > Acme website redesign"
source: "[[Tasks#Acme website redesign]]"
---

# Ask [[Maya Chen]] whether order NP-4821 can arrive before 2026-08-14

- [x] Ask [[Maya Chen]] whether order NP-4821 can arrive before 2026-08-14 ✅ 2026-07-31
  - Why: the brochures are required for the launch event
  - Related: [[Acme launch plan]]
```

By default, generated notes are stored in:

```text
Archive/Tasks/YYYY/MM/
```

The date-based folders keep storage tidy while the `topic` property remains the primary way to group and query tasks.

## Settings

- **Source task note:** note monitored for completed tasks; defaults to `Tasks.md`.
- **Completed task notes folder:** base output folder; defaults to `Archive/Tasks`.
- **Organize notes by year and month:** creates `YYYY/MM` subfolders.
- **Add source property:** links back to the original note and topic heading.
- **Add heading path property:** stores the full nested heading path.
- **Conversion delay:** waits briefly after edits before processing.
- **Show conversion notice:** displays a confirmation notice.

## Manual command

Run **Completed Tasks to Notes: Convert completed tasks to notes now** from the Command Palette.

## Safety and duplicate handling

- Source tasks are removed only after their generated notes are verified.
- Tasks edited during conversion remain in the source note.
- Identical tasks receive occurrence-specific identities.
- Filename collisions receive a stable short suffix instead of overwriting another note.
- Checkbox examples inside fenced code blocks are ignored.
- Existing generated notes are detected through an internal identity marker.

## Upgrading from Topic Task Archiver

Version 2.0 changes the storage model from one archive note per topic to one note per completed task. Existing topic archive notes are not modified or migrated. The old archive-folder setting is automatically reused as the completed-task notes folder.

## Installation

Copy `main.js`, `manifest.json`, and optionally `styles.css` into:

```text
<vault>/.obsidian/plugins/completed-tasks-to-notes/
```

Restart Obsidian or reload the plugin, then review **Settings → Completed Tasks to Notes**.
