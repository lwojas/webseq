# webseq

## UI work

This repo has a `ui-audit` skill at `.claude/skills/ui-audit/SKILL.md`. Run it immediately after
any task that adds or edits a React component (`src/components/**`, `src/App.tsx`) or
`src/index.css` — before considering the task done, not just when asked. It checks the change
against the project's existing style system and against mobile/touch-friendliness, and fixes
what it finds directly. It only needs user confirmation if a fix risks changing behavior rather
than just styling.

It's also runnable on demand for a manual pass — e.g. "run the UI audit" or "audit the mobile
view" — on any part of the UI, not just recent changes.
