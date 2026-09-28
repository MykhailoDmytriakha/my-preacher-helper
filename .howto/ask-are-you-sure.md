when: are you sure · confirm dialog · confirmation before delete · destructive action · window.confirm · useConfirm · ConfirmModal · confirmDialog · two confirmations fire · system dialog appears after custom modal · Escape closes the form too · confirm drawn under the form · focus on Cancel · test a confirm modal · test hangs on confirm · stub loops for ever · вы уверены · подтверждение удаления · диалог подтверждения · опасное действие · два подтверждения подряд · системное окно подтверждения · Escape закрывает и форму · тест зависает на подтверждении

# Ask "are you sure?"

Use `useConfirm()` from `frontend/app/hooks/useConfirm.tsx`: `const { confirm, confirmDialog } = useConfirm();`, then `if (!(await confirm({ title: t('…') }))) return;`, and render `{confirmDialog}` in the same component. Never `window.confirm`.

## How

- `confirm({ title, description, confirmText, cancelText, destructive })` returns a promise of `true` / `false`. `destructive` defaults to `true` (red button, warning icon) because the question almost always comes before a deletion; pass `false` for a neutral question. Texts go through `t(…)`.
- No provider: each component owns its question and renders its own window. A second `confirm` while one is open answers the first "no"; a component unmounting while it asks answers "no". Nothing is left waiting.
- It draws `frontend/app/components/ui/ConfirmModal.tsx`: a portal to `document.body`, `useModalLayer`, `z-[300]` above every form, Escape closes only the question (not the form it was asked from), and focus starts on Cancel so a stray Enter answers "no".
- Need a busy state or extra content inside the question? Render `ConfirmModal` directly with `isOpen`, `onConfirm`, `onClose`, plus `isDeleting`, `confirmDisabled` or `children` (`frontend/app/components/column/DeletePointConfirmModal.tsx`).
- Replacing an old `window.confirm` with the window: delete the `window.confirm()` call from the handler too. Otherwise both fire in sequence — the custom window says yes, then the system dialog appears.

## Tests

- Walk the whole lifecycle: click the trigger → `await screen.findByRole('dialog')` → click the confirm button inside it → assert the callback ran. Cancel must not run it.
- A child stub that calls the delete handler during render now loops for ever: every call opens a new question, the re-render calls the handler again. A stub calls the handler once, from a click.

## Why

- `window.confirm` blocks the page and every automated browser check, looked like a foreign system alert on iOS, and one copy was hard-coded Russian for every interface language — nine call sites were replaced (header of `useConfirm.tsx`).
- `ConfirmModal` once sat on a third-party dialog with its own layer order: it was drawn under our forms, and one Escape closed both the question and the form.
- 2026-02-27: a `window.confirm()` left in the parent handler fired right after the custom modal's yes.
- 2026-09-16: the stub that called `onDelete` on every render hung the test suite for five minutes.

See also: `.howto/open-a-modal.md`
