when: planned and never opened — nothing to close yet · phase 2 is missing or closed — plan it first · phase name must be English, 1–3 words · el todo move L1 · move a later item into a phase · phase close needs a summary · same session · accepted by a second hand · закрыть фазу · фаза не открыта · перенести пункт из «на потом» · приёмка той же сессией

# Lead an el phase without hitting its three walls (el 1.37.0)

Three walls met in a long case and sent as reports to the el maintainer (2026-10-05, `elephant-cli/feedback/`). Until el changes, the way around each:

- **Open the phase before the first `done`.** `el phase plan N "Name" --goal "…"` only names the phase; items can be added to it, and el also lets you `done` and `accept` them there — but `el phase close N` then refuses with exit 4 «planned and never opened — nothing to close yet». So: `el phase open N` right after the plan, before any work in it.
- **Taking a later item into a new phase — the whole way at once:** `el phase plan N "<English, 1–3 words>" --goal "…"` → `el todo move L1 N` → `el phase open N` → work. The first refusal names only `--goal`; the English-name rule comes as a second refusal.
- **Acceptance by the same session is recorded, but not where people read.** The collapsed phase line in TODO.md shows only the summary you type at `el phase close`; el's own count (`acceptance: … same session N`) sits inside `phases/<n>-<name>.md`. Write the count into the close summary yourself, e.g. «… · accepted: same session 5/5» — never «by a second hand» when it was the same session.
- `el phase close N` without a summary prints an example with another phase number — ignore the number, give the summary.
