when: duplicate toasts · error shown twice · two toasts for one error · raw error shown to user · Usage cap reached for ai · English error text in a translated UI · typed error handled globally · UsageCapReachedError · isUsageCapReachedError · UsageCapGlobalHandler · UsageCapDialog · notifyUsageCapReached · throwIfUsageCapReached · retry draft saved for an error that will fail again · catch shows a generic error · shared recovery toast · два тоста · ошибка показана дважды · сырая ошибка пользователю · английский текст ошибки · лимит исчерпан · уведомление об ошибке · тост

# Show an error once

Some typed errors already have one owner that tells the person. The usage cap (`UsageCapReachedError`) is announced by `UsageCapGlobalHandler` (`frontend/app/components/usage/UsageCapGlobalHandler.tsx`, mounted in `frontend/app/providers/QueryProvider.tsx`). Every UI `catch` must recognise such an error first and step aside: no toast, no generic message, no retry draft.

## How

- First line of the catch: `if (isUsageCapReachedError(error)) return;` (after any local cleanup), before generic formatting, `toast.error`, or saving anything for a retry. Examples: `usePlanActions.ts`, `frontend/app/components/column/audio.ts`, `studies/[id]/page.tsx`.
- Keep cleanup (loaders, per-item pending flags) in `finally` or inside the guard branch, so the early return does not leave a spinner running.
- Do not persist a recovery copy for an owned error; it can only fail again on resend. `runVoiceTranscription` in `studies/[id]/page.tsx` returns before it stores the recording draft.
- A local state change is fine when it is not a second announcement: `audio.ts` sets its own `limitReached` flag and a translated card line instead of showing `error.message`.
- The global side announces each error object once: `notifyUsageCapReached` in `frontend/app/services/usageCapClient.ts`, raised from the HTTP reply by `throwIfUsageCapReached` in `frontend/app/utils/apiClient.ts`.
- Regression-test through a real component catch, not the handler alone: feed a `UsageCapReachedError` and assert `toast.error` was not called (`frontend/__tests__/components/column-audio-helper.test.ts`).
- The same one-voice rule covers write refusals: the shared recovery toast from `useWriteRecovery` (`frontend/app/utils/recoverableWrite.ts`) speaks for them. A settings toggle only restores its switch (`StructurePreviewToggle.tsx`), and a modal that has already closed stays silent on a late refusal (`frontend/__tests__/components/CreateThoughtModal.test.tsx`).

## Why

- 2026-07-15: after the global handler existed, per-call catches still showed raw or generic errors, a second toast, and saved retry drafts. The cap's `error.message` is `Usage cap reached for ai`, a sentence for developers; it reached the card and a red toast on top of the handler's own message: one event, three announcements.

See also: `.howto/track-pending-per-item.md`
