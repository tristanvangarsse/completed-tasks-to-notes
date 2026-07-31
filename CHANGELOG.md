# Changelog

## 1.0.1

- Sorts monthly archive sections newest-first, so `2026-07` appears above `2026-06`.
- Re-sorts existing monthly sections whenever a new completed task is archived to that topic.

## 1.0.0

- Fixed loss of identical tasks by assigning occurrence-specific identities.
- Added collision-safe topic archive filenames.
- Switched archive modifications to atomic `Vault.process()` writes.
- Leaves tasks in the source note if they change during archiving.
- Ignores checkbox examples inside fenced code blocks.
- Added editor-change triggering and reduced default delay to 120 ms.
- Added an Archive delay setting, clamped between 50 and 2000 ms.
- Added stable topic markers and retained archive-entry idempotency markers.
