**T64 — Compose existing `useAutoSave` for note autosave; fix flush-on-unmount lost write.**

Repo: `/Users/mykhailo/MyProjects/my-preacher-helper/frontend`.

## Problem
`app/(pages)/(private)/studies/[id]/page.tsx` defines a `useNoteAutoSave` hook (~lines 184–305) that:
- Computes an `editableSignature` (JSON.stringify of title/content/tags/scriptureRefs/type/rootNode).
- Keeps `lastSavedSignatureRef` + `lastSeenNoteIdRef` to skip no-op saves and reset on noteId switch.
- Debounces via `setTimeout(saveChanges, 1500)` in `useEffect`.
- **Loses pending writes on unmount** — if user navigates within 1500ms after their last edit, change is dropped.

Meanwhile, `app/hooks/useAutoSave.ts` exists and already provides:
- Lodash-debounce-based debouncing.
- `'idle' | 'saving' | 'saved'` status state.
- `flush()` on unmount.
- Used by `groups/[id]/page.tsx:221`.

## Fix
Refactor `useNoteAutoSave`:
1. Delegate debounce + flush-on-unmount + isSaving state to `useAutoSave` (or its underlying hook — read its source first).
2. Keep the signature-ref guard as a thin pre-save check (return early if signature unchanged).
3. Keep `lastSeenNoteIdRef` for noteId-change reset.
4. Keep `existingNote.isUnchanged` secondary guard with signature-advance fix from previous wave.
5. Preserve all current external behavior: hook returns `{ isSaving, lastSaved, saveError, setLastSaved }`. Tests in `app/(pages)/(private)/studies/[id]/__tests__/page.test.tsx` must continue to pass without modification (25 tests).

## Implementation hint
- Read `app/hooks/useAutoSave.ts` first to understand its API (debouncedSave / status / flush).
- The current `saveChanges` callback can stay; what changes is the **trigger** — instead of `useEffect → setTimeout`, drive it via `useAutoSave`'s debounced trigger.
- Flush on unmount: useAutoSave should call `debouncedSave.flush()` in its own cleanup. Verify; if it doesn't, add it.

## Constraints
1. **Same external API** of `useNoteAutoSave` — return shape unchanged.
2. **Tests must pass without modification** — `studies/[id]/__tests__/page.test.tsx` 25 tests stay green.
3. **Don't lose the noteId-reset and isUnchanged-advance fixes** from the previous wave.

## Deliverables
- `app/(pages)/(private)/studies/[id]/page.tsx` — refactored `useNoteAutoSave`.
- Possibly `app/hooks/useAutoSave.ts` — minor enhancement if flush-on-unmount is missing.
- New tests for the lost-write-on-unmount scenario in `app/(pages)/(private)/studies/[id]/__tests__/page.test.tsx` — mount, dispatch a change, unmount before debounce fires, assert save fired.

## Acceptance
- `npx tsc --noEmit` passes.
- `npx jest "studies/\[id\]/__tests__"` — 25 (or more, if new tests added) tests pass.
- `npx jest app/components/studies/node` still 53+ pass.

No commits. Listed files only.
