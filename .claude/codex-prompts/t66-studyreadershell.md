**T66 — Extract `StudyReaderShell` shared between NotePreviewModal and FocusView; add `createPortal`.**

Repo: `/Users/mykhailo/MyProjects/my-preacher-helper/frontend`.

## Problem
`app/(pages)/(private)/studies/components/NotePreviewModal.tsx` and `app/(pages)/(private)/studies/components/FocusView.tsx` are sibling components, both fullscreen overlay → read-only note card. Each rolls its own scaffolding: `createPortal` (FocusView yes, NotePreviewModal NO — convention break), body-scroll lock, Esc handler, fade-in/zoom animations. The chrome differs (FocusView has prev/next nav, NotePreviewModal has pill-bar), but the **shell** is duplicated.

## Fix
Extract `app/(pages)/(private)/studies/components/StudyReaderShell.tsx` providing the shared scaffolding:

```ts
interface StudyReaderShellProps {
  isOpen: boolean;
  onClose: () => void;
  /** Accessible label for the dialog. */
  ariaLabel: string;
  /** Floating top-right action group. */
  topRightSlot?: ReactNode;
  /** Optional sticky header above the scroll body (e.g. eyebrow + title). */
  headerSlot?: ReactNode;
  /** Scrollable body — receives the note content. */
  children: ReactNode;
  /** Modifier to switch aesthetic between the two existing modals. */
  variant?: 'preview' | 'focus';
}
```

Responsibilities of the shell:
1. `createPortal` to `document.body`.
2. `useScrollLock(true)` while open.
3. Esc key handler → `onClose`.
4. Click-outside-content (backdrop) → `onClose`.
5. Backdrop styling + fade-in animation.
6. Card sizing — `width: min(96vw, 920px)`, `height: min(94dvh, 920px)` for `variant='preview'`; `variant='focus'` uses the full-bleed layout that FocusView currently has (read FocusView to mirror its sizing).
7. Card animation (zoom-in 0.97→1, translate-y 10→0, fade).
8. Empty/loading state opt-in via children — shell does NOT own content.
9. Focus restoration on unmount (preserve currently focused element, restore on close).
10. `aria-modal="true"`, `role="dialog"`, label via `aria-label` prop.

Refactor NotePreviewModal to use StudyReaderShell. Refactor FocusView to use StudyReaderShell (mind its different layout; if `variant='focus'` needs custom styles, accept a `cardClassName` prop or similar — keep it minimal).

## Constraints
1. **No behavioral regression** in either modal. Tests for FocusView (if any) must pass. NotePreviewModal currently has no dedicated tests — verify rendering manually by running `npx jest "studies/\[id\]/__tests__"`.
2. **NotePreviewModal portal**: currently it does NOT portal — once shell portals, ensure modal still mounts above page content (z-index correct, no transform/filter ancestor traps).
3. Existing pill-bar (top-right) in NotePreviewModal moves into `topRightSlot`. Existing sticky-header (eyebrow + title + hairline) moves into `headerSlot`.
4. FocusView's prev/next nav — figure out where it fits. Probably as part of its `topRightSlot` or extra slot. Read FocusView first.
5. i18n strings already added under `studiesWorkspace.notePreview.*` — keep.

## Deliverables
- `app/(pages)/(private)/studies/components/StudyReaderShell.tsx` (NEW).
- `app/(pages)/(private)/studies/components/NotePreviewModal.tsx` — refactored.
- `app/(pages)/(private)/studies/components/FocusView.tsx` — refactored.
- Optional: small test for `StudyReaderShell` covering Esc / backdrop click / scroll lock / portal mount.

## Acceptance
- `npx tsc --noEmit` passes.
- `npx jest app/components/studies/node "studies/\[id\]/__tests__"` — all 90 tests pass.
- FocusView still functions in real use (verify FocusView usage sites; usually a `useState` toggle pattern).

No commits. Listed files only.
