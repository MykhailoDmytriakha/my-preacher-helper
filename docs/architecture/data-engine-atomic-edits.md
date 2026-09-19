# Atomic client ownership for related documents

Working design, 2026-09-19. The server already commits related documents atomically;
client ownership of a multi-document user action is the remaining series blocker.
This document records the next implementation contract, not a completed migration.

Implemented foundation: server/HTTP ACKs now expose and validate `relatedSnapshots`
beside committed metadata. Six real emulator cases cover replay/current content,
no-op relation proof and concurrent assignment. IndexedDB participant create/CAS batches are now atomic and single saves use that
same path. Queue coordination now captures all participants in one transaction, prepares one
immutable series command, projects participant-specific ACKs together, and retains
all dependency/projection references. This is an internal engine capability;
public membership editing and series UI migration remain outstanding.

## Observable contract

Moving a group from A to B is one saved action. Offline, both lists reflect that
same pending action. Reload preserves it. Reconnect commits both effects or
neither. A competing move to C refuses/conflicts without silently stealing the
assignment. Later typing is retained. Account changes clear every presentation.

An ACK is proof of the whole transaction; a primary document alone is insufficient
for adopting the confirmed content of another participant. The next client layer
must retain one immutable operation identity and participant-specific opening
versions. It must not infer another participant's confirmed content from an
optimistic list or fetch a new ancestor at Save time.

## Chosen implementation direction

Extend the existing command/request ownership inside DataEngine; keep one runtime,
transport, local database, conflict reducer and retention policy. Each affected
resource needs its captured ancestor, intended value and causal predecessors.
Feature code names the domain action and renders shared status. It cannot construct
protocol commands, submit a second queue or compensate a half-completed move.

First provide related accepted snapshots in an ACK response, separate from compact
receipt history. The initial transaction already owns these snapshots, so returning
them adds response bytes but no reads. Replay materializes current related snapshots
with the same owner/generation/revision checks as the primary, inside its transaction.
History still stores only committed metadata. Missing proof remains retryable and
must never repeat a previously accepted operation as a new identity.
An older server may omit the copies. Replay also omits them if later content grows
past the 8 MiB effect budget, while retaining the valid compact ACK proof. The
future atomic client must then fetch participants individually and validate them
against the committed metadata before retiring their local projection.

Then extend request capture, participant projection, dependency retention and editor
handoff together. A request touching A and B must be visible from either editor;
its ACK must project each participant before its local evidence is compacted.
Unsubmitted text stays in its editor/manual stage. Requests based on earlier queued
work wait for those exact requests and rebase only later edits through the existing
merge rule. A fresh server read is not a substitute for a captured ancestor.

Finally migrate series CRUD/readers and the membership surfaces as one compatible
boundary. Protective rules precede activation. Groups remain off in production
until their delete cascade can coexist with every series writer.

## Alternatives rejected

- Two ordinary updates plus rollback: a crash can leave half a move, and rollback
  can overwrite a concurrent edit.
- A feature-owned membership outbox: duplicates recovery, account fencing and replay.
- A second persistent membership truth: requires a separate schema migration and
  reconciliation with `series.items`; it is not needed for the current contract.
- Use only primary ACK and call optimistic related rows confirmed: loses the server's
  independently merged fields and can clear newer typing.
- Store every full related document in every receipt: makes retained history grow
  with content and breaks the compact-receipt operating budget.

## Required evidence before activation

1. Move A to B offline, leave both screens, reload, reconnect: one atomic effect.
2. Both participant lists/editors see pending intent and later the confirmed result.
3. Concurrent A-to-B / A-to-C: one assignment; losing intent remains recoverable.
4. Unrelated remote fields survive, including in a related participant on lost-ACK replay.
5. Participant deletion or changed generation cannot resurrect or overwrite it.
6. Later edits to A or B survive an earlier transaction ACK.
7. Ambiguous local forks are offered explicitly, never chosen by timestamp.
8. Storage failure sends nothing; cancellation cannot retire unknown delivery.
9. Account switch and late responses cannot expose the previous owner's content.
10. Atomic reference-aware compaction retains all participant dependencies.
11. Detector catches direct SDK/HTTP writes on every migrated membership surface.
12. Real emulator concurrency plus browser/PWA restart proof, with physical-device
    gaps stated separately and measured read/write/response-size costs.

## Implementation checkpoint: shared queue ownership

`commits.ts` owns saved requests. Each atomic participant keeps its own captured
baseline, value and predecessor, with one immutable `atomic` identity naming the
whole group. `atomicCommits.ts` is its coordinator, not a second executor: it uses
`DataEngineRuntime` and the existing journal. Initialization uses the same
`initializeCommit` predecessor rebase as ordinary saves. The server command is stored once on the root request; its identity and every
participant's prepared state commit in one batch before submission. Editor pending
identities retain the shared operation alias, including after restart. The original identity survives
unknown delivery and restart.

The relation policy accepts membership-only intent. Ordinary fields must be saved
through their document editor. The protocol bounds the group at the existing
100-resource ceiling; referenced members and owner scans also consume that ceiling,
so some groups below 100 participants can still be refused as too large. Existing
multi-add screens may touch several source series, so the old two-series wire
limit was insufficient. No large action is silently split into independent writes.

Every explicit series participant receives committed evidence even if concurrent
work already satisfied it. Compact replay advances no revision. ACK projection
requires each participant's original proof and a matching current copy. Missing
copies use a proof-aware read: a stale cache cannot satisfy it. Missing proof keeps
the original journal, never turns optimistic values into confirmed content. The
local participant results win one batch CAS before the journal can be retired.
`DataSession` and collection presentation then use their existing acceptance rules.

An explicit failed-action cancellation expands to the complete participant group
and its dependent local requests. Unknown delivery remains uncancellable. Retention
holds all participants while any delivery, projection, manual scope or predecessor
reference needs them. Snapshot-cache writes are separate from the request database;
this does not claim one transaction across two IndexedDB databases.

Still required before activation: a public engine-owned membership scope that pins
versions when the action opens, UI integration (including bulk add and reorder),
legacy writer/cache migration, real browser/PWA restart acceptance and rollout/rules
verification. Internal queue tests are not proof that these screens are migrated.

### Mixed-version local storage

Atomic participants use `atomic-request` rows in the existing state database.
Older bundles scan only `request`; adding a field to that old range would allow
an old tab to split an action into separate commands. New reads and retention use
`readCommitRows` over both ranges. Identity/reference keys and ordinary generations
stay compatible; one generation cannot change ownership format. The shared runtime
journal contains one complete command and remains safe for old executors to replay.
No atomic requests were deployed in the prior single-range prototype.

## 2026-09-19 — pinned membership stage (local implementation)

`MembershipScope` owns one staged semantic action and one explicit Save. Opening
through `DataEngine.beginMembership` requires a complete cached series list and
pins confirmed versions plus explicit submitted predecessors before presenting the
selector. Ambiguous/refused/deleting work blocks opening; no fresh ancestor is
read at Save. A queued series creation remains an explicit dependency.

`membershipIntent.ts` projects assign/remove/reorder through the existing pure
series item helpers. Changed source series and the assignment target participate
together, even when the target already contains the selected member. An unchanged
target still needs lifecycle validation before removing the remaining source.

Stages live in a separate `membership-scope` range with CAS revisions. Save freezes
the stage durably before `CommitQueue` captures any requests. Further editing or
cancellation is forbidden while capture is uncertain; retry/recovery uses the same
scope/resource/generation identities. Recovery alone never submits. Leaving a
selector preserves a staged action and lets an invoked local Save finish.

Capture and stage completion are separate transactions, so each request initially
acquires a `reference/capture` hold in its creation transaction. Stage completion
transfers it to the stage reference in one transaction. This closes
`BUG-20260919-membership-capture-retention-gap`: another editor may consume an ACK
before the stage records its IDs, but cannot compact the only dedupe evidence.
Old collectors already honor the reference range. Only complete ACK/cancellation
allows compaction; failures retain their whole original stage.

The public `useDataMembership` hook supports begin/update/save/recover/cancel,
delivery status, identity-preserving retry and whole-action discard. Presentation
is fenced by account and response order. It is not yet connected to domain screens.
All series callers, explicit re-selection UX after refusal, and live browser/PWA
acceptance remain outstanding. Production activation is still forbidden.

## Whole-action resolution

A document editor cannot Keep Local or Accept Remote on behalf of an unresolved
atomic action. Both the queue boundary and the shared status enforce this; hiding
buttons alone is insufficient. The action owner explicitly discards through
`DataEngine.discardMembership(scopeId)` after delivery is proven failed.
Unknown delivery cannot be discarded. The action and its dependent requests use
one compare-and-set transaction, so a concurrent revision or disk failure cannot
retire only half of the local chain.

Cancellation carries explicit action provenance. `DataSession` removes the
cancelled membership projection while retaining later saved/unsent metadata and
unrelated conflicts. Mounted editors and closed-checkpoint recovery share this
rule. Otherwise the next ordinary autosave could submit only the source removal.
Stage compaction can be retried after cancellation; it must not trigger another
network operation or lose the remaining local recovery evidence.
