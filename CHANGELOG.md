# Changelog

## 1.0.0

- Initial community release.
- Convert completed tasks into individual Markdown notes.
- Add configurable properties for topic, status, completion timestamp, type, heading path, source, and plain-text content.
- Optionally include clean task content in the generated note body.
- Preserve task context and links while removing Markdown styling from the `content` property.
- Generate note filenames of up to 60 characters without cutting words where possible.
- Handle filename collisions with numeric suffixes.
- Remove source tasks only after the generated note has been created and verified.
