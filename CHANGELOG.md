# Changelog

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
