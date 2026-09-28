when: sermon from a study note · create sermon from note · cut a note into scratch notes · note cut · atoms · cornerstone claim · studies/notes/[id]/cut · CreateSermonFromNoteModal · sourceNoteIds · scratch at birth · Too many scratch notes at birth · invalid-scratch-provenance · model invented a heading or key passage · groundKeyPassage · collectNoteHeadings · duplicate sermon on retry · newClientId · scratch order scrambled · createdAt ties · noteCutCorridor · expected number of scratch notes · 413 note too long · 422 nothing cut · проповедь из заметки · создать проповедь из изучения · нарезка заметки · наброски · наброски при рождении проповеди · заметка слишком длинная · дубль проповеди при повторе · порядок набросков перепутан · модель выдумала заголовок · useDocumentActions · engine create · stable client ID · read-only proposal · legacy POST · создание через движок · черновое предложение · стабильный идентификатор

# Create a sermon from a study note

The cut route reads an owned stored note and returns a proposal without writing it. `CreateSermonFromNoteModal` then creates the sermon through `useDocumentActions().create` when sermons are engine-owned, using one stable client ID per opening and including `sourceNoteIds` and `scratch` in the creation. The preacher builds the plan on the scratch board.

## How

- A scratch note is an atom: one cornerstone claim in the author's words plus its Scripture, with `source: { noteId, heading }`. The count is derived (one atom per claim), not chosen: `expectedScratchCountCorridor` (`frontend/app/utils/noteCutCorridor.ts`, in words and paragraphs) is shown to the person before the cut and handed to the model as guidance — one function for both.
- The route only reads. Ownership is checked on the note before its text reaches a prompt. It cuts the note as stored: the dialog never uploads editor text, and the opener waits while the note has unsaved edits. `GET` answers the note's sections and slices without calling a model; `POST` cuts one slice `[offset, offset + limit)`, the browser drives slices in order and retries a failed slice alone.
- Refuse, never truncate or call an empty cut a success: 413 for a note over the size limit, 422 when no claim was found, 400 for an empty note or a slice outside it.
- Structured output proves shape, not truth. A heading survives only if the note writes it (`collectNoteHeadings`), a key passage only if the note contains it (`groundKeyPassage`); otherwise it is dropped, never stored as provenance or written into the sermon's verse.
- Atoms get increasing `createdAt` (1 ms apart; later slices later): the board and the composer order scratch by time and break ties by id, which would scramble the argument.
- One sermon id per dialog: `newClientId()` runs when the dialog opens and every attempt reuses it, so a retry after a lost answer addresses the same sermon instead of making a second one. A failed create after a good cut retries only the write; the atoms stay in memory.
- The modal keeps the cut proposal in memory and submits only the chosen sermon creation through the engine. On that path the server accepts each new `sourceNoteIds` entry only if it is a live note of the owner, and each scratch `source.noteId` must name one of them (`invalid-scratch-provenance`) — `frontend/app/data-engine/serverRelations.ts`. At most 20 source notes and 300 scratch notes at birth (`frontend/app/data-engine/resourceSchemas.ts`).
- After either creation path, the current modal also seeds the legacy React Query detail/list cache for the next screen. That cache is not the engine's durable intent, delivery status or confirmed snapshot; do not copy this seeding as an engine write mechanism.

## Legacy paths (unconverted collections only)

These compatibility paths are not templates for new features.

- The legacy road `POST /api/sermons` (`frontend/app/api/sermons/route.ts`) applies the same limits, refuses notes of another owner, whitelists scratch fields, keeps `source` only for verified notes, and answers in committed form — what was written, never the request echoed back.

## Why

- 2026-09-05: four design passes moved the note's structure somewhere (a proposal, headings, a lens) and each was rejected; the unit that held is the atom, and the plan stays the preacher's. Building it exposed three classes: a create without a client id duplicates the sermon on an ambiguous retry; a model-named heading or passage the note never wrote was about to become provenance and the verse; atoms born with one `createdAt` were scrambled, and a create answering with the request seeded a cache copy that differed from the document.
- The whole note in one model call took 36.2 s of the 60 s function limit, leaving no room to retry a transient provider failure; hence the slices.

See also: .howto/link-two-entities.md · .howto/raise-route-time-limit.md · .howto/run-jest-tests.md
