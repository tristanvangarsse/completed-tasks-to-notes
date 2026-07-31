# Changelog

## 2.0.5

- Include the full task block in the `content` property instead of only the first line.
- Flatten nested bullets and continuation lines into a single semicolon-separated value suitable for Obsidian Bases.

## 2.0.4

- Added an optional `content` property containing the task's main text for display in Obsidian Bases.
- Added an independent toggle for including task content in the generated note body.
- Removed the duplicate heading from generated note bodies.
- Render completed tasks as plain text in the body instead of checkbox items.
- Remove the completion-date marker from body text while retaining the `completed` property when enabled.

## 2.0.3

- Added independent on/off toggles for `topic`, `status`, `completed`, `type`, `heading-path`, and `source` properties.
- Omit YAML frontmatter entirely when every property is disabled.
- Removed the internal HTML identity comment from generated task notes.
- Verify the exact newly created file content before removing the source task.

## 2.0.2

- Fixed identical or similarly named tasks disappearing when an older generated note already contained the same internal marker.
- Existing filenames are now always treated as collisions, producing `_1`, `_2`, and subsequent suffixes before the source task is removed.

## 2.0.1

- Store generated notes directly in the configured output folder.
- Name notes as `YYYY-MM-DD_<first-40-task-characters>.md`.
- Add `_1`, `_2`, and subsequent numeric suffixes for filename collisions.
- Remove the year/month folder setting.

## 2.0.0

- Renamed the plugin to **Completed Tasks to Notes**.
- Changed the plugin ID to `completed-tasks-to-notes`.
- Replaced topic archive notes with one generated note per completed task.
- Added `topic`, `status`, `completed`, `type`, `heading-path`, and `source` properties.
- Added optional year/month output folders.
- Preserved full task blocks, including indented context and links.
- Added collision-safe filenames and idempotent generated-note markers.
- Kept the safety rule that source tasks are removed only after output is verified.
- Added migration of compatible settings from Topic Task Archiver.

## 1.0.1

- Sorted monthly archive sections newest-first.

## 1.0.0

- Added collision-safe topic archive filenames and atomic archive updates.
