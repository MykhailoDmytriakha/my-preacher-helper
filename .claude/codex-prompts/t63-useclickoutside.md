**T63 — Extract `useClickOutside` hook and migrate the 2 newest sites.**

Repo: `/Users/mykhailo/MyProjects/my-preacher-helper/frontend`. React 18 + TS strict.

## Problem
20+ hand-rolled `document.addEventListener('mousedown', …)` click-outside implementations exist across the codebase. This wave added 2 more (in `NodeTextEditor.tsx` outside-click guard for the wikilink picker; in `NodeTreeEditor.tsx` outside-click for edit mode exit). No shared hook exists.

## Fix
Create `app/hooks/useClickOutside.ts`:

```ts
export function useClickOutside(
  refs: Array<RefObject<Element | null>>,
  handler: () => void,
  options?: { enabled?: boolean; capture?: boolean; event?: 'mousedown' | 'click' }
): void
```

Behavior:
- When enabled (default true), attaches `document.addEventListener(event, …, capture)` (event default 'mousedown', capture default false).
- On event, checks if `event.target` is contained by any provided ref's element. If none contain it, calls `handler()`.
- Handles `event.target instanceof Node` defensively.
- Properly cleans up listener on unmount or `enabled=false`.
- Idempotent re-render — listener identity stable so RTL tests don't see leakage.

## Migration (this PR only)
- `app/components/studies/node/NodeTextEditor.tsx` — replace the `useEffect` outside-click block (around `picker.open` + `wrapperRef` / `pickerRef`) with `useClickOutside([wrapperRef, pickerRef], closePicker, { enabled: picker.open })`.
- `app/components/studies/node/NodeTreeEditor.tsx` — replace the `useEffect` outside-click block that dispatches `stopEdit + setFocus(null)` with `useClickOutside([containerRef], () => { dispatch({ type: 'stopEdit' }); dispatch({ type: 'setFocus', nodeId: null }); }, { enabled: state.isEditingText })`.

**Do NOT migrate the other ~20 existing usages** — that's a separate follow-up. Only the 2 sites added in this wave.

## Constraints
1. Hook signature must accept multiple refs (the picker case needs wrapper + picker refs both excluded).
2. Capture-phase support optional — needed for `NotePreviewProvider` (not migrated here, but design the API for that case too).
3. TS strict — no `any`.

## Deliverables
- `app/hooks/useClickOutside.ts` (NEW).
- `app/hooks/__tests__/useClickOutside.test.tsx` (NEW) — at minimum cover: click inside ref → handler NOT called; click outside → handler called; disabled → no listener; capture-phase option works; multiple refs (any contains → skip).
- `app/components/studies/node/NodeTextEditor.tsx` — migrated.
- `app/components/studies/node/NodeTreeEditor.tsx` — migrated.

## Acceptance
- `npx tsc --noEmit` passes.
- `npx jest app/hooks/__tests__/useClickOutside` passes (new tests).
- `npx jest app/components/studies/node` passes (no regression).

No commits. Only listed files.
