when: drag and drop · reorder a list · dnd-kit · useSortable · DragOverlay · collisionDetection · MeasuringStrategy · @hello-pangea/dnd · Droppable · Draggable · tab freezes while dragging · Unable to find drag handle · dragHandleProps · isDragDisabled · drop snaps late · placeholder jump · list jerks after drop · hover changes height · onBeforeCapture · drag back saves anyway · nested droppables · drop a point inside a point · file a scratch note · resolveNoteSlot · boardDnd · elementsFromPoint · overlay far from the finger · target flickers parent child · перетаскивание · перетащить карточку · драг-н-дроп · изменить порядок списка · вкладка зависает при перетаскивании · карточка прыгает при бросании · вложить пункт в пункт · разложить наброски по плану

# Drag and drop a card or a row

Two libraries. `@dnd-kit/core` for anything that nests or files into containers — the plan board (`frontend/app/components/plan-editor/OutlineBoard.tsx` + `useOutlineBoardDrag.ts`, rules as plain functions in `frontend/app/utils/boardDnd.ts`), the structure page, council and service-order lists. `@hello-pangea/dnd` only for flat lists (`frontend/app/components/Column.tsx`, `frontend/app/components/column/SubPointList.tsx`, `frontend/app/components/sermon/SermonOutline.tsx`). A drag that means both "inside a card" and "between cards" needs dnd-kit: in hello-pangea a draggable enters only a droppable of its own `type`, and nested droppables of one type are unsupported.

## How — dnd-kit

- Listeners on the handle only, never on the row: `handleProps={{ ...attributes, ...listeners, ref: setActivatorNodeRef }}` (`care/council/[id]/page.tsx`, `care/orders/page.tsx`). Row focus and text selection in inputs stay intact.
- Sensors `MouseSensor` distance 6 and `TouchSensor` delay 180 / tolerance 8: a tap on the handle stays a click, and a scroll does not start a drag.
- Filing into containers: the target is the whole container (pool, point card, sub-point row), the deepest under the pointer wins (`noteContainerDepth`). The position inside it is the nearest card's half (`resolveNoteSlot`; cross-axis weighted ×8, so a grid row-mate beats the card above on a 12px tie). The one signal is the slot the neighbours open — full height at home, at most `NOTE_COMPACT_SLOT_HEIGHT` elsewhere, so a tall note does not shove its destination away. No invisible bands.
- One atomic move: `onMove(noteId, target, neighbourIds, index)` (`outlineBoardTypes.ts`) names the container and the place; `onPlace` only re-files without order. A place-then-reorder pair cannot express a position in another container.
- Points and sub-points keep their own inside/beside vocabulary (`DROP_PREFIX`, `allowedCollisions`) behind one router, `collisionDetection` in `useOutlineBoardDrag.ts`.
- The flying copy is the card itself in `DragOverlay`, with the modifier `keepHandleUnderFinger` so the handle stays where it was grabbed.

## Traps that freeze the tab — no unit test sees them, drive the live page

1. Container from measured rects → loop: the opening slot makes it taller, dnd-kit's rect is older, the pointer "leaves", the slot closes. Read the live DOM: `document.elementsFromPoint` → closest `[data-note-container]` (`noteContainersUnderPointer`).
2. Card hidden on the library's `isDragging` → dnd-kit measures it for the overlay in the activation render; a `display:none` card is 0×0 at the page corner and the copy collapses far from the finger. Hide it one render later on your own state (`liftedNoteId`, `ScratchNoteLayer.tsx`) and keep it mounted.
3. `MeasuringStrategy.Always` recomputes collisions on every re-measure; a slot opening above a row shifts it under a still pointer → target oscillates parent↔child. Recompute only when the pointer or the page scroll moves: cache key = rounded pointer + `window.scrollX/scrollY`. Without scroll in the key, auto-scroll drops into the stale pre-scroll slot.

## How — @hello-pangea/dnd

- Every active `Draggable` renders an element with `dragHandleProps` in every state — display, inline edit, optimistic `new-*` items — or dev throws "Unable to find drag handle". A locked item gets `isDragDisabled` while its handle wrapper stays mounted (`Column.tsx`); edit mode keeps the handle (`renderSubPointItem` in `SubPointList.tsx`).
- No sibling spacing (`space-y-*`) on the list around draggables: `provided.placeholder` copies the margins of the place it was lifted from, not where it lands, and the list below moves at the drop (8px for `space-y-2`). Each draggable carries its own gap (`mb-2` in `Column.tsx` and `SermonOutline.tsx`, `mb-0.5` in `SubPointList.tsx`). The last one's margin is then extra space unless it collapses into the next block: in the outline the block after each list has a larger top margin (`mt-4`, `mt-0.5`), so the resting layout did not change — check the following block before reusing this.
- A draggable whose height depends on `:hover` is measured hovered at lift and drawn unhovered for a frame after the drop: the points below jump up and back. The sermon outline still does this on wide screens through the hover-only "add sub-point" row (BUG-20261004-outline-hover-row-jerk). Pinning the dropped point open was tried and dropped: it needs pointer-end tracking and release on every input, scroll, blur and a timer, and each review round found another edge. Remove the height change instead.

## Drop end

- A true no-op returns before any optimistic write: same index (`handleDragEnd` in `SubPointList.tsx`), the note's own slot (`useOutlineBoardDrag.ts`), `hasMeaningfulDropChange` / `shouldSkipUpdate` in `useStructureDnd.ts`. Otherwise a slight drag-back runs a save cycle and a sync highlight.
- But a no-op recompute can hide a real reorder (two cards: the preview swapped them, `over` collapses onto the dragged card); `useStructureDnd.ts` then commits the same-container preview.
- Hand the new outline to follow-up writes: `onOutlinePointMoved(pointId, destinationSection, updatedOutline)` and `onSubPointMoved(…, updatedOutline)` let thoughts re-sync to the destination before React re-renders.

## Measuring a drop

- A drop is motion; screenshots do not show it. Sample every frame (`requestAnimationFrame`) the top of each item and of the flying clone, then compare the last frame with the clone against the first frame without it, and every later frame against that one: any item that moves is a snap. Reload after the move to prove it was stored, and cancel with Escape (on a narrow page "far to the side" can still be a list). The tool is in the case data of 2026-10-03-bugs-37 (`toend.cjs`, Playwright + system Chrome headless, test-user login on localhost).
- A hidden Claude-in-Chrome window draws no frames (`requestAnimationFrame` never fires, even with focus), so a drag there never animates — measure in headless Chrome instead.
- The dev server must run with the production engine switches, or writes go the legacy way and production rules refuse them ("Сохранение отклонено").
- jsdom answers `:hover` with true for every element: a unit test of hover-dependent code must stub `matches(':hover')` per case.

## Why

- 2026-09-06: one point card gave four visual answers decided by invisible bands; owner: "the machine catches every pixel, my movements are rough". Designed in a standalone demo (frontend/.demo/scratch-dnd.html, git-ignored) with both candidates on a toggle and an event log in localStorage; the log exposed a false failure — a real mouse over the tab re-aimed the drop between synthetic steps.
- 2026-06-23: the plan editor first ran one hello-pangea context with separate point and sub-point droppable types; dropping a point into a point is what moved it to dnd-kit.
- 2026-03-05 late placeholder snap · 2026-03-18 drag-back saves · 2026-04-25 and 2026-05-10 missing handle in locked and edit states.
- 2026-10-04: the sermon outline jerked at every drop — 8px from `space-y-2` (fixed, BUG-20260927-outline-dnd-spacing-late-snap) and, on wide screens, 24px from the hover-only add row (open, BUG-20261004-outline-hover-row-jerk); measured frame by frame at 390/820/1180/1500px.
