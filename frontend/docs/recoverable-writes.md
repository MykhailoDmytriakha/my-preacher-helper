# How this project writes data

**Read this before adding a new entity or write operation.** Copying a neighbouring hook is how the defect below returned four times.

## The defect this contract prevents

Writes here are offline-first: a hook starts a mutation and **returns control immediately**. Therefore, `await createThing(...)` completes when the write is **started**, not when it is accepted. A caller that immediately used `toast.success(...)` announced success for a write the server had not seen.

Measured live on 2026-08-12 with emulator rules that reject every write: the person saw both “Group created successfully” and “Save refused.” The same happened when creating a prayer and adding a sermon to a series.

## The contract

A write must expose its actual ownership boundary. The public data-engine action promise resolves after durable local capture, not server delivery. Keep that `Promise<void>` intact. Legacy network/mutation writers return `WriteSubmission` to distinguish acceptance from eventual persistence. `WriteOperation` accepts either; `awaitWriteOperation` awaits the real owner and returns `null` for local engine capture, so it cannot be mistaken for a server-persisted receipt.

Acceptance has three distinct outcomes:

| Outcome | Meaning | What may be said to the person |
|---|---|---|
| `persisted` | The server stored it. | Success may be announced — **only here**. |
| `queued` | A durable queue owns the write and will finish it. | **Do not announce saving**; the on-screen row already signals acceptance. |
| `skipped` | Nothing was started: either an identical write is already running (`in-flight`) or the action opened a dialog instead of writing (`awaiting-confirmation`). | Nothing happened, so announce nothing. |

A refusal is **not** an outcome. It **rejects** `acceptance`, so the editor catches it and stays open with the person's text. The MESSAGE is not the editor's job: the hook's recovery descriptor says it and carries the text (see “Who reports a late refusal”). The one exception is a write that never reached a mutation at all — `refusedWrite`, used when there is no signed-in user or the document is gone. No descriptor can ever see such a write, so it ANNOUNCES ITSELF — the translated sentence is a required argument, and no editor repeats it. The editor just holds the draft.

## Which road a write takes

There are two, and a collection is on exactly one of them.

- **The data engine** — the ten collections in `app/data-engine/engineOwnedCollections.ts` (sermons, series, groups, prayer requests, study notes and materials, tags, councils, orders of service, plan templates). Write only through `app/data-engine/react.client.tsx` (`useDataDocument`, `useDataForm`, `useDocumentActions`, `useDataMembership`). Delivery, the offline queue, conflicts and refusals belong to the engine: `DataSyncStatus` beside the editor says a refusal while the screen is open, and `EngineConflictBanner` says it after the editor has closed. Whole-document creators return the actual public engine promise. Do not wrap it in `queuedMutation`/`queuedWrite`: their launch-time timer can clear the form before capture, and a later disk failure then loses the input. Older non-create adapters still need the separate audit recorded in BUGS.md. Do not declare `useWriteRecovery` for these collections, and do not add a legacy writer: the browser rules and the server refuse it (`refuseLegacyWriteRoute`).
- **React Query mutations** — what is not on the engine: the user's settings (`users`) and study-note share links. Their legacy hooks declare `useWriteRecovery` descriptors, as described below; users settings select the engine path when enabled.

## Canonical example: creating a prayer

Read these three files in order (the group example that stood here left with the legacy group hook on 2026-10-12):

- **Hook** — `app/hooks/usePrayerRequestsEngine.ts`: `createPrayer` returns the actual capture promise with its stable `prayerId` attached. A failed capture is reported by the hook while the form keeps its words; server answers after capture belong to the engine.
- **Editor** — `app/components/prayer/CreatePrayerModal.tsx`: the prop is typed as `WriteOperation`; submit awaits `awaitWriteOperation`, and on capture failure keeps the form and all its text open. Legacy edit submissions retain their acceptance and late reporting.
- **Page** — `app/(pages)/(private)/prayers/page.tsx`: passes the submission to the editor and **does not announce success**.

The core is `app/utils/recoverableWrite.ts`; its tests are in `__tests__/utils/recoverableWrite.test.ts`.

## What to do in new code

**When writing an engine hook.** Return the public facade capture promise unchanged. Do not label it persisted from connection state or start a second queue. Templates, tags and prayer creators are examples; `settingsWrite.ts` delegates to the same await boundary.

**When writing a legacy hook.** Return `WriteSubmission`: use `persistedWrite(promise)` when awaiting a real write (`mutateAsync` or an awaited service); use `queuedMutation(receipt, promise)` when the operation is offline-first and a queue takes ownership; use `skippedWrite()` when an identical write is already running (or `skippedWrite('awaiting-confirmation')` when the action asks a question first); use `refusedWrite(code, message, announce)` when nothing holds the person's text — no signed-in user, or the document is gone. The third argument is the translated sentence the person reads: such a write never becomes a mutation, so no descriptor can speak for it, and it announces itself. The editor just keeps the draft. Nearby, declare `useWriteRecovery` with a descriptor that has the mutation key, fallback title key, **all entered text** in `recoveryText`, a stable `toastId`, an ownership check (`owns`, plus `ownershipEpoch` when that check depends on a list that loads later), and `retry`.

**When writing an editor.** Type mixed ownership props as `WriteOperation`. In submit, `await awaitWriteOperation(write, onLateFailure)` and close only afterward. A capture failure keeps the input and is explained once by its creator/form owner; after durable capture the engine owns server refusal and recovery. For legacy submissions only, the following descriptor rules apply. In `catch`, keep the form and everything typed in it — and say NOTHING. The refusal message belongs to the hook's recovery descriptor: it carries the text, offers “copy my text”, and keeps reporting after the editor closes. An editor that also speaks turns one refused action into two failures, which is the single most repeated defect in this migration.

Two exceptions, and only these two: input the app will not accept (a reserved tag name) is explained by the FORM, next to the field, and the descriptor skips it via `ignore`; and a stale-revision conflict offers a CHOICE, so the screen owning that choice shows it and the descriptor `ignore`s stale errors.

**When you want to say “saved.”** Use only `announceIfPersisted(acceptance, () => toast.success(...))`. Queued and skipped writes cannot pass through it by design.

## What not to do

Do not use a launch-only promise as proof of ownership, wrap an engine capture in a timer receipt, call `toast.success` after local capture or an unfinished mutation, create a custom refusal subscription instead of `useWriteRecovery`, announce success for an offline queue, invent refusal wording instead of `writeRecovery.refused`, or add a second reporter for a write that already has a descriptor.

## The limits of the `queued` promise

`queued` means “the write was taken by something that will finish it,” but the owner and durability differ across the three paths:

| Path | Owner | Survives |
|---|---|---|
| `queuedMutation` — offline, paused mutation | React Query + persister in IndexedDB | A page reload; it resumes when the network returns. |
| `queuedMutation` — online, in-flight request | The request itself | Nothing: an unexpected tab close during this window loses the write. |
| `replicaAcceptedWrite` / offline outbox | Firestore SDK queue or an outbox in IndexedDB | A reload; the edit is in storage. |

This table describes the legacy mutation/SDK paths, not the public engine capture promise. The middle row is an **accepted residual risk**, not an oversight. Acceptance yields one tick (see `queuedWrite` in `recoverableWrite.ts`), and a slow asynchronous `onMutate` can start the mutation later. A resulting refusal arrives on the **late** path: the contract still holds — the person is told the truth, their text returns in a recovery message with “Copy my text,” and the write is not presented as saved. The only weakened claim is “owns” during those milliseconds. For expensive text, close that gap with a durable draft (`durableDraft.ts`), not a mutation-start signal.

## Who reports a late refusal

The descriptor rules in this section apply to legacy mutations. Engine-owned writes use their canonical durable requests and `EngineConflictBanner`; they must not add a React Query descriptor. A failure before capture still belongs to the creator/form that holds the input.

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

## Textless access revocation

A failed share-link revoke remains important after restart even though it carries no typed text. Its descriptor explicitly uses `retainWithoutTextAcrossSessions`; ordinary switches and failed creates keep the default silence for old textless errors. `utils/studyNoteShareLinkWrites.ts` owns the stable keys, recovery identifiers and one acknowledged-delete handler for the live hook and restored defaults. The existing mutation cache retains the unresolved action; only a successful DELETE for the same owner and permanent link ID retires its failures. A list response is not proof of that operation. The handler preserves neighboring failures and paused work, patches an already-known list without inventing an empty loaded list, and prunes earlier successful delete records. There is no second storage or queue.

## What has not moved yet

Study-note share links and the settings (`users`) fallback use the React Query road. Settings use their shared engine promise when the collection is enabled. A screen on the legacy path follows the descriptor contract above; moving such a collection to the engine is a migration of its own (`docs/architecture/data-engine-migration-log.md`), not a copy of a neighbouring hook.
