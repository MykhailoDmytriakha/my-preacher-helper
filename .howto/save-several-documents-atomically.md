when: several documents in one save · atomic save · partial write · half-applied move · move a sermon between series · assign remove reorder series members · useDataMembership · beginCreate · openSeries · updateCreation · saveAtomic · atomicCommits · series-member-create · create a member inside a series · preset series · discard whole action · canDiscard · DataMembershipStatus · dangling thought reference · duplicate placement · sermonIntegrity · preservesSermonLinks · EngineThoughtModal · sermonThoughtEdits · capture reference · dedupe lost after restart · атомарное сохранение · несколько документов разом · частичная запись · перенести проповедь между сериями · создать проповедь внутри серии · всё или ничего · висячая ссылка на мысль · CommitQueue.saveAtomic · creation-scope · creation-request · reference hold · whole-action discard · atomic regression · атомарная команда · сохранение ссылки · отмена всего действия

# Save several documents atomically

For engine-owned series, stage a multi-document action through `useDataMembership()` in `frontend/app/data-engine/react.client.tsx`; one Save captures one command for all participants. A new member created inside a series uses the same stage. Fields of one sermon that must agree use one `useDataForm` command. See "Series membership actions" in `frontend/app/data-engine/README.md` and `docs/architecture/data-engine-atomic-edits.md`.

## How

- Call `begin()` before opening the selector, confirmation or drag: it pins the displayed series copies and their exact saved predecessors. `update(action)` stages durably without sending; `save()` freezes the stage and captures one command through `CommitQueue.saveAtomic` (`frontend/app/data-engine/commits.ts`). Never read a fresh baseline at Save, never open a new stage inside an old form's Save callback.
- Participant ownership, proofs and cancellation live in `frontend/app/data-engine/atomicCommits.ts`: one queue, one journal, no second transport.
- Delivery belongs to the whole action: `delivery`, `retry()` (same identity), `discard()` only for proven failed delivery (`delivery.canDiscard`). Discard retires the whole chain and restores membership while keeping later metadata edits and conflicts. Unknown delivery is retried, never replaced. A participant document's Keep local / Accept remote cannot resolve an atomic action. UI: `DataMembershipStatus`; `SeriesMembershipRecovery` mounted once in the private workspace; selectors reuse `SeriesMembershipDialog`.
- New member inside a series: `beginCreate(collection, initialValue, requestedSeriesId?)` durably owns the new ID and typing before any catalog read; `updateCreation` persists typing; only `openSeries()` reads and pins the destination catalog; `update(null)` means standalone. One `save()` validates the whole draft and captures `series-member-create`. A preset series blocks Save until it is pinned and selected or explicitly cleared, and survives restart. Retry keeps the ID and capture identity. Consumers: `EngineCreateSermonModal`, `AddSermonModal`, workspace recovery; `useSermonsDataCollection` shows submitted creation in lists and the calendar.
- Storage: creation stages and requests use their own ranges (`creation-scope`, `creation-request`) so older readers cannot recover half the intent; reference rows keep predecessors alive. A capture reference is written in the same IndexedDB transaction that creates the request (`frontend/app/data-engine/commits.client.ts`) and moved to the stage when it completes (`frontend/app/data-engine/membershipScopes.client.ts`).
- Thoughts: Save-button editing is `EngineThoughtModal` + `useDataForm`, never a late patch against a newer ancestor. The pure transforms in `frontend/app/utils/sermonThoughtEdits.ts` (`addSermonThought`, `patchSermonThought`, `replaceSermonOutline`) change the thought, `structure` / `thoughtsBySection` and outline together; outline writers update affected assignments in the same command.
- Server side, `applyCommand` (`frontend/app/data-engine/protocol.ts`) runs `preservesSermonLinks` on the merged candidate: new dangling point / sub-point references, placements of missing thoughts and duplicate placements are refused; defects already present and untouched stay repairable.

## Legacy paths (unconverted collections only)

The old `useSeriesMembership` / `seriesMembership.client.ts` writer is compatibility code, not a template for a new multi-document action. Do not chain its calls or independent document saves to imitate atomic Save.

## Why

- 2026-09-19: another editor consumed the ACK before the stage had recorded its request IDs, and compaction erased the evidence that deduplicates the action after a restart. The reference is now acquired with the request and transferred in one transaction.

See also: .howto/use-data-engine-in-a-screen.md · .howto/order-sermon-thoughts.md
