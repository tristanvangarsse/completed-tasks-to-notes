# Topic Task Archiver 1.0.0

Automatically dates and moves checked tasks from one active task note into one archive note per nearest topic heading.

## Install or update

1. Back up your vault.
2. Copy this folder to `<vault>/.obsidian/plugins/topic-task-archiver/`, replacing the older files.
3. Restart Obsidian, or disable and re-enable **Topic Task Archiver**.
4. Review **Settings → Topic Task Archiver**.

Defaults:

- Source note: `Tasks.md`
- Archive folder: `Archive/Tasks`
- Archive delay: `120` ms
- Group by month: enabled

## Example

```markdown
# Tasks

## Acme website redesign

- [ ] Ask [[Maya Chen]] at [[Northstar Printing]] whether order NP-4821 can arrive before 2026-08-14
  - Why: the brochures are required for the launch event
  - Related: [[Acme launch plan]]
```

Checking the task adds `✅ YYYY-MM-DD`, moves the entire block, and files it under the completion month in the archive note for `Acme website redesign`.

## Safety improvements in 1.0.0

- Identical tasks under one topic receive distinct occurrence identities.
- Archive writes use Obsidian's atomic `Vault.process()` API.
- A source task is removed only after its archive entry exists.
- Tasks edited while archiving remain in the source note rather than being deleted.
- Filename collisions receive a stable topic suffix instead of merging unrelated topics.
- Checkbox examples inside fenced code blocks are ignored.
- Both editor changes and saved-file changes trigger archiving.
- The default delay was reduced from 500 ms to 120 ms.

## Existing collision archives

Version 1.0 prevents new collisions. It does not automatically split an archive note that an older version already merged. Review any known collided archive manually once.

## Context rule

Make the first line understandable on its own:

`VERB + PERSON/ORGANIZATION + SPECIFIC SUBJECT + OBSERVABLE DESIRED OUTCOME`

Use indented lines for `Why`, `Details`, `Related`, order numbers, dates, or other context. They move with the task.

## Recovery

Run **Topic Task Archiver: Archive completed tasks now** from the Command Palette to process checked tasks manually.


Monthly archive sections are kept in newest-first order (for example, `2026-07` above `2026-06`).
