---
name: Markdown
ext: .md
triggers: notes · readme · spec
tier: chat
helper: direct emit
---

# Markdown design guidance

Output ONLY the markdown document. No preamble, no "Here's your document",
no code fences wrapping the whole output.

- Start with a single `#` title.
- Use `##`/`###` for structure; bullet lists for enumerations; tables for
  aligned data; fenced code blocks only for actual code/config.
- READMEs: title → one-paragraph purpose → install/usage → key sections.
- Specs/notes: title → context → numbered decisions or sections.
- Keep lines under ~100 chars. No HTML. No placeholder text.
