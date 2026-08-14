# How this project writes data

**Read this before adding a new entity or write operation.** Copying a neighbouring hook is how the defect below returned four times.

## The defect this contract prevents

Writes here are offline-first: a hook starts a mutation and **returns control immediately**. Therefore, `await createThing(...)` completes when the write is **started**, not when it is accepted. A caller that immediately used `toast.success(...)` announced success for a write the server had not seen.

Measured live on 2026-08-12 with emulator rules that reject every write: the person saw both “Group created successfully” and “Save refused.” The same happened when creating a prayer and adding a sermon to a series.

## The contract

A write returns a **`WriteSubmission`**, not `Promise<void>`. This is not style: only `WriteSubmission` lets the call site distinguish “the write started” from “the write was accepted.” `Promise<void>` cannot, so it is forbidden in write props.

Acceptance has three distinct outcomes:

| Outcome | Meaning | What may be said to the person |
|---|---|---|
| `persisted` | The server stored it. | Success may be announced — **only here**. |
| `queued` | A durable queue owns the write and will finish it. | **Do not announce saving**; the on-screen row already signals acceptance. |
| `skipped` | Nothing was started: either an identical write is already running (`in-flight`) or the action opened a dialog instead of writing (`awaiting-confirmation`). | Nothing happened, so announce nothing. |

A refusal is **not** an outcome. It **rejects** `acceptance`, so the editor catches it and stays open with the person's text. The MESSAGE is not the editor's job: the hook's recovery descriptor says it and carries the text (see “Who reports a late refusal”). The one exception is a write that never reached a mutation at all — `refusedWrite`, used when there is no signed-in user or the document is gone. No descriptor can ever see such a write, so it ANNOUNCES ITSELF — the translated sentence is a required argument, and no editor repeats it. The editor just holds the draft.

## Canonical example: creating a group

Read these three files in order:

- **Hook** — `app/hooks/useGroups.ts`: `createNewGroup` returns `queuedMutation(...)`; nearby, `useWriteRecovery(...)` receives one descriptor instead of a hand-built subscription.
- **Editor** — `app/components/groups/CreateGroupModal.tsx`: the prop is typed as `WriteSubmission`; submit awaits `awaitAcceptance`, and on refusal keeps the form and its text open.
- **Page** — `app/(pages)/(private)/groups/page.tsx`: passes the submission to the editor and **does not announce success**.

The core is `app/utils/recoverableWrite.ts`; its tests are in `__tests__/utils/recoverableWrite.test.ts`.

## What to do in new code

**When writing a hook.** Return `WriteSubmission`: use `persistedWrite(promise)` when awaiting a real write (`mutateAsync` or an awaited service); use `queuedMutation(receipt, promise)` when the operation is offline-first and a queue takes ownership; use `skippedWrite()` when an identical write is already running (or `skippedWrite('awaiting-confirmation')` when the action asks a question first); use `refusedWrite(code, message, announce)` when nothing holds the person's text — no signed-in user, or the document is gone. The third argument is the translated sentence the person reads: such a write never becomes a mutation, so no descriptor can speak for it, and it announces itself. The editor just keeps the draft. Nearby, declare `useWriteRecovery` with a descriptor that has the mutation key, fallback title key, **all entered text** in `recoveryText`, a stable `toastId`, an ownership check (`owns`, plus `ownershipEpoch` when that check depends on a list that loads later), and `retry`.

**When writing an editor.** Type the prop as `WriteSubmission`. In submit, `await awaitAcceptance(submission, onLateFailure)` and close only afterward. In `catch`, keep the form and everything typed in it — and say NOTHING. The refusal message belongs to the hook's recovery descriptor: it carries the text, offers “copy my text”, and keeps reporting after the editor closes. An editor that also speaks turns one refused action into two failures, which is the single most repeated defect in this migration.

Two exceptions, and only these two: input the app will not accept (a reserved tag name) is explained by the FORM, next to the field, and the descriptor skips it via `ignore`; and a stale-revision conflict offers a CHOICE, so the screen owning that choice shows it and the descriptor `ignore`s stale errors.

**When you want to say “saved.”** Use only `announceIfPersisted(acceptance, () => toast.success(...))`. Queued and skipped writes cannot pass through it by design.

## What not to do

Do not use `Promise<void>` in write props, call `toast.success` after an unfinished mutation, create a custom refusal subscription instead of `useWriteRecovery`, announce success for an offline queue, invent refusal wording instead of `writeRecovery.refused`, or add a second reporter for a write that already has a descriptor.

## The limits of the `queued` promise

`queued` means “the write was taken by something that will finish it,” but the owner and durability differ across the three paths:

| Path | Owner | Survives |
|---|---|---|
| `queuedMutation` — offline, paused mutation | React Query + persister in IndexedDB | A page reload; it resumes when the network returns. |
| `queuedMutation` — online, in-flight request | The request itself | Nothing: an unexpected tab close during this window loses the write. |
| `replicaAcceptedWrite` / offline outbox | Firestore SDK queue or an outbox in IndexedDB | A reload; the edit is in storage. |

The middle row is an **accepted residual risk**, not an oversight. Acceptance yields one tick (see `queuedWrite` in `recoverableWrite.ts`), and a slow asynchronous `onMutate` can start the mutation later. A resulting refusal arrives on the **late** path: the contract still holds — the person is told the truth, their text returns in a recovery message with “Copy my text,” and the write is not presented as saved. The only weakened claim is “owns” during those milliseconds. For expensive text, close that gap with a durable draft (`durableDraft.ts`), not a mutation-start signal.

## Who reports a late refusal

The **entity hook** (`useWriteRecovery`) owns the message: the right wording, the person's exact text, and a
retry that works. Its descriptor MUST declare `owns` — failed mutations persist in a shared IndexedDB cache
that outlives a sign-out, so an unguarded descriptor would read the previous account's text to whoever signs
in next. Where ownership depends on a list that may still be loading, pass `ownershipEpoch` as well: a
restored failure skipped while the list was empty is examined again when the list arrives.

**One refusal, one reporter — and the reporter is the descriptor.** Where a hook declares `useWriteRecovery`,
the editor must NOT show its own refusal message: the descriptor carries the person's text, offers the copy
action, and keeps reporting after the editor closes. The editor's job on a refusal is to stay open and hold
what was typed. Two reporters showed one refused action as two failures, in two different wordings — the
single most repeated defect across nine review rounds.

Two exceptions, both narrow: input the app will not accept (a reserved tag name) is explained by the FORM,
next to the field, and the descriptor skips it via `ignore`; and a stale-revision conflict offers a CHOICE
rather than a message, so it keeps its own UI.

**A reporter nobody can see has not reported.** Every editor in this app is a full-screen
overlay, so while one is open it hides the row badge that owns its write. The rule that follows is
exclusive, not additive: the OPEN editor says the verdict, the covered reporter renders nothing, and
the moment the editor closes the reporter takes over with the complete draft. That is still one
refusal and one reporter — the same one, moving with the person's eyes. Implemented by
`onOpenChange`/`onEditorOpenChange` on the sermon editors, read by the screens that draw the rows.
This applies only where the reporter is INLINE; a recovery toast renders above the overlay and needs
no such handover.

One path deserves naming because it looks like an exception and is not: thought editing writes DIRECTLY (no
mutation, therefore no descriptor), so `reportLateRefusal` is its single reporter — it says the message once
and additionally reopens the editor when the person is still on the page, because a draft reappearing in
silence reads as a glitch rather than a refusal. Wherever a descriptor exists, the descriptor is the reporter
and the editor stays silent.

Sign-out dismisses recovery messages (`firebaseAuth.service.ts`). They deliberately live until dismissed,
because they hold text someone must not lose — which is exactly why they must not outlive that someone.

**A hook is mounted by a page, so a refusal that lands after the person navigates away is reported by nobody.**
That gap is real and tracked: `BUG-20260813-late-refusal-silent-after-navigation`. An app-level universal
reporter was built for it and then removed — it needed to know each payload's shape, its owner, who had
already reported and whether a message was visible, and every review round found a new way for those four
to disagree, including reading one account's text to another. The right fix is delivery rather than
observation: carry the refusal with the write (a durable draft marked "refused"), so the screen that started
it shows it when it next opens.

## What has not moved yet

Migration is incremental. Some surfaces still use older schemes (`.mutate()` without the contract, awaiting an ordinary promise, or custom queues). The migration state and order are in `.sessions/SESSION_2026-08-12-modal-refusal-live-proof.md`. When you touch one of these surfaces, move it to the contract instead of copying it.
