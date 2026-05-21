**T67 — Modal focus trap: keyboard Tab loops inside the dialog.**

Repo: `/Users/mykhailo/MyProjects/my-preacher-helper/frontend`.

## Problem
`app/(pages)/(private)/studies/components/StudyReaderShell.tsx` (just extracted) renders dialogs with `aria-modal="true"` but has no keyboard focus trap. Tab can move focus outside the dialog into the (visually-hidden) background page. Focus restoration on close already works.

## Fix
Add Tab focus trap to `StudyReaderShell`:
1. On open: query all focusable descendants of the dialog content (`button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable=true]`).
2. On `keydown` Tab inside dialog: if at last focusable + Tab → focus first; if at first focusable + Shift+Tab → focus last.
3. On mount: focus first focusable (or the dialog container with tabindex="-1" as fallback).
4. Re-query focusable set when DOM mutates inside the dialog (use `MutationObserver` scoped to the dialog ref, or simply re-query on every Tab keydown — simpler, no observer needed for low-frequency Tab events).

Both `variant='preview'` and `variant='focus'` benefit — implement once in shell.

## Constraints
1. **No regression in `useScrollLock`, Esc handler, backdrop click, focus restoration.** All existing behavior preserved.
2. Skip `display: none` / `hidden` focusables (RTL queries respect this — `el.offsetParent !== null` is the standard predicate).
3. `prefers-reduced-motion` already honored — keep.
4. If the dialog has zero focusables (edge case), Tab is a no-op (don't crash).
5. **Don't introduce new deps.** Headless UI is in package.json but its Dialog brings its own scaffolding that would re-do scroll lock / portal; implement the trap inline.
6. TS strict.

## Test
Add to `app/(pages)/(private)/studies/components/__tests__/StudyReaderShell.test.tsx` (create if missing):
- Tab from last focusable → first focusable.
- Shift+Tab from first → last.
- Tab no-op when dialog has zero focusables.
- First focusable receives focus on mount.

## Acceptance
- `npx tsc --noEmit` passes.
- `npx jest app/(pages)/(private)/studies/components/__tests__/StudyReaderShell` passes new tests.
- `npx jest app/components/studies/node "studies/\[id\]/__tests__" NotePreviewProvider FocusView` — all 101+ existing tests still pass (no regression).

No commits. File: StudyReaderShell.tsx + its test file.
