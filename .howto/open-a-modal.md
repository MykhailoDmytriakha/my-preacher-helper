when: open a modal · modal dialog · popup window · FormDialog · useModalLayer · createPortal · modal under the nav · modal behind header or card · z-50 does not help · stacking context · modal does not scroll on mobile · trapped scrolling · touch-trapping · nested scroll in modal · page scrolls behind the modal · background scrolls on iOS · Escape closes two windows · aria-modal · data-note-sheet · study pane scrolls under dialog · modal width · modal textarea auto-grow · one modal per list item · test a portal · mock createPortal · модальное окно · модалка · всплывающее окно · диалог · окно под навигацией · окно за шапкой · окно не прокручивается на телефоне · фон прокручивается под окном · Escape закрывает два окна · Escape cancels edit and closes window · inner Escape · Escape отменяет правку и закрывает окно · слой окон · Save button scrolls away · buttons scroll off the dialog · кнопка Сохранить уезжает · кнопки прокручиваются вместе с текстом

# Open a modal window

A new form window is `FormDialog` (`frontend/app/components/ui/FormDialog.tsx`): it portals to `document.body`, joins the modal stack through `useModalLayer`, and has the phone shape built in. A window you draw by hand needs both pieces itself: `createPortal(…, document.body)` and `useModalLayer` spread on its overlay. A yes/no question is `useConfirm` (`.howto/ask-are-you-sure.md`).

## How

- `FormDialog` props: `title`, `onClose`, `tone` (`blue` / `emerald` / `rose`), `size` (`compact` / `form` / `standard` / `wide` — the width comes from here), `dismissOnBackdrop`, `closeDisabled` (a save is in flight), `onSubmit` to wrap it in a form. `FormActions` is the Cancel/Save pair.
- Passing `footer` switches the shape: head and foot stay put, only the middle band scrolls, and on a phone the window rises from the bottom edge (`max-h-[92vh]`). Without `footer` it is one scrolling panel, full height on a phone (`h-[100dvh]`).
- A form dialog puts its `FormActions` in `footer` and its submit handler in `onSubmit` (example: `components/calendar/EnginePreachDateModal.tsx`), with `showCloseButton` to keep the X. `FormActions` inside the children scrolls away with long content — twelve dialogs did that from 2026-09-07 until 2026-09-29. Never nest a `<form>` inside the dialog's own form.
- Hand-drawn overlay: `const layer = useModalLayer({ onClose, active: isOpen, closeDisabled })`, then `<div {...layer} className="fixed inset-0 z-[100] …">`. The hook (`frontend/app/hooks/useModalLayer.ts`) holds the page still (counted locks; iOS is pinned by `useScrollLock`, because `overflow: hidden` on the body does not stop Safari), lets Escape close only the topmost window, and registers the layer. The backdrop click stays the caller's choice — a form with typing in it must not vanish on a stray tap.
- Always `createPortal(content, document.body)`. Rendered in the tree, a modal lives inside its ancestors' stacking context (an element that has its own z-order bubble; nothing inside can rise above that element's siblings), so `z-50` still loses to the sticky nav (`z-40`), cards and floating buttons, worst on phones. Guard the server render: return `null` while `typeof document === 'undefined'` (`ConfirmModal`) or until a `mounted` state is set.
- Layers in use: `FormDialog` `z-[100]`, `FormDialog` with footer `z-[110]`, full-screen editors and conduct screens `z-[200]`, `ConfirmModal` `z-[300]` above all.
- The panel carries `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. `aria-modal="true"` is also the switch `frontend/app/globals.css` keys on to lock the study page's own scroll panes (`[data-study-workspace]`, `[data-note-scroll-region]`) while any dialog is open. The study mobile sheet is marked `data-note-sheet` and sets `aria-modal=false` while mounted but closed; its `data-note-sheet-scroll` pane locks too when another dialog opens above it.
- One scroll container per window. No `overflow-y-auto` on small sub-containers inside a phone modal: touch gets trapped in the small box and the rest of the content cannot be reached. The window's content itself must stay scrollable.
- Mount one modal at the container, not one per list item: `Column.tsx` renders `DeletePointConfirmModal` once, and each `OutlinePointCard` asks for it with `onDeletePoint(id)`.
- Several older overlays still render in the tree without a portal (`ColorPickerModal`, `KeyFragmentsModal`, `AudioExportModal`, …) — do not copy them.
- A textarea that grows inside a modal: `.howto/make-a-text-field-grow.md`.

## Traps

- A part inside a window that answers Escape itself (inline edit cancel, a calendar popover, a keyboard drag lift, a point note) must stop the press: `e.stopPropagation()` in a React handler, or in a document-level listener — the window listens at the window and runs last. Without it one Escape cancels the edit AND closes the window (BUG-20261003-escape-cancelling-inner-action-closes-dialog). Do not key the window on `defaultPrevented` instead: ProseMirror prevents every Escape it sees, so rich-text fields would stop closing their window (`__tests__/components/ui/escapeInsideDialogs.test.tsx`).

- Study page, wheel scrolling: `useNoteScrollIsolation` scrolls panes with `scrollBy`, and a programmatic scroll ignores `overflow: hidden` — so it checks the lock before scrolling. `useNoteScrollPosition` decides who owns the scroll from the CSS flag `--note-pane-scroll`, never from `overflow`, because a modal changes overflow without changing the owner. Regression to keep: rotating the device repeatedly while a dialog is open must keep the reading anchor.
- Tests: `screen` queries see a portal in `document.body`. Tests that need it inline mock `react-dom` with `...jest.requireActual('react-dom')` plus `createPortal: (node) => node` (`frontend/__tests__/components/navigation/FeedbackModal.test.tsx`).

## Why

- 2026-02-26: long modals with an inner `max-h` scroll box trapped touch on phones; the fix was one scroll container for the whole window.
- 2026-03-15: modals rendered in the tree sat under the nav and cards on phones despite `z-50`.
- 2026-09-05: a portalled modal over a study must lock every background scroll owner, not just `body`, and the rotation anchor must not mistake that lock for a change of owner.
- 2026-09-16: 38 hand-drawn overlays each decided alone what a modal owes; the owner scrolled his sermon list away behind the open "New sermon" form. `useModalLayer` moved the rules into one hook without rewriting the markup.

See also: `.howto/ask-are-you-sure.md` · `.howto/make-a-text-field-grow.md`
