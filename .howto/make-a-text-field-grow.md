when: textarea autosize · auto-grow textarea · field grows with text · TextareaAutosize · react-textarea-autosize · minRows · maxRows · multiline input · input type text for long text · one-line field for a note · Enter submits too early · Shift+Enter new line · textarea height wrong after resize · scrollbar narrows textarea · modal textarea grows · buttons pushed off screen by a long field · поле растёт с текстом · автовысота поля · многострочное поле · текстовое поле · Enter отправляет раньше времени · перенос строки · длинное поле выталкивает кнопки

# Make a text field grow with its content

Free-form text — a note, a thought, a description — is a `TextareaAutosize` from `react-textarea-autosize`, never `<input type="text">`. Set `minRows`; add `maxRows` only where the field sits inside a bounded form.

## How

- `import TextareaAutosize from 'react-textarea-autosize'` — the repository standard, used in ten components (`frontend/app/components/PointNote.tsx`, `frontend/app/components/sermon/ScratchPanel.tsx`, `frontend/app/components/sermon/SermonFormDialog.tsx`, …).
- Note fields: `minRows={2}` and no `maxRows` — scratch capture in `ScratchPanel`, `PointNote` (scratch cards and outline point / sub-point notes), the point editors in `OutlineBoard`.
- Form fields in a dialog: `minRows` + `maxRows` — `SermonFormDialog` title 1–4 rows and verse 3–10 rows, `CreateGroupModal`, `SeriesFormFields`.
- Uncapped fields keep `resize-none overflow-hidden`: a native scrollbar that appears during a viewport resize narrows the wrapped text and makes the measured height wrong.
- Decide the Enter contract on purpose and keep it: scratch capture submits only by its button (Enter is a new line, Escape collapses the form); `PointNote` saves on Enter and on blur, Shift+Enter is a new line, Escape cancels.
- Inside a modal, let `FormDialog` with a `footer` keep the head and the buttons fixed while the middle band scrolls, so a growing field never pushes the buttons off screen (`.howto/open-a-modal.md`).
- Do not hand-roll the height: `frontend/app/components/common/EditableVerse.tsx` still measures `scrollHeight` against a guessed 20 px line height — the library does this correctly.
- Check in a real browser: open, type several lines, delete back (the field must shrink), resize the window, press Escape, and confirm the save contract still holds.

## Why

- 2026-07-26: manual scratch capture was an `input type="text"` — one line only, and Enter submitted half a thought. A multiline field says "multiline" through its control; autosize is behaviour, not a CSS patch.
- 2026-09-05: `PointNote` moved to the same autosize; the `overflow-hidden` rule came from its resize case.

See also: `.howto/open-a-modal.md`
