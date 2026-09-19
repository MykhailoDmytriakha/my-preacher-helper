# DataEngine operating budget and retention

Measured/reviewed 2026-09-19. This is an operating contract and a reproducible
protocol-cost model, **not a measurement of the project's billing account**.
Production switches and deployed rules were not changed for this work.

## Reproduce the protocol budget

From `frontend`:

```sh
npx jest --runInBand --coverage=false __tests__/data-engine/server.test.ts app/data-engine/__tests__/collections.test.ts app/data-engine/__tests__/observer.test.ts
```

The server tests execute the actual command/list/feed implementations against an
instrumented transactional adapter. They count document reads, returned query
rows (at least one for an empty query) and writes. They do not model transaction
retries, index-entry billing, SDK listener traffic, rules-dependent reads, network
bytes, authentication or hosting. Those must be reconciled with real usage during
a controlled rollout. Cloud billing reports remain the external source of truth.

| Operation, without transaction retries | Document reads | Document writes |
|---|---:|---:|
| Single-document create or update, no dependencies | 3 | 4 |
| Replay of the same acknowledged operation | 2 | 0 |
| Competing update producing a conflict receipt | 2 | 1 |
| Atomic material/note relation, two documents in two collections | 5 | 7 |
| Replay of that two-document relation, including current participant copies | 3 | 0 |
| Empty collection listing | 3 | 0 |
| One live document, no tombstones, one list page | 3 | 0 |
| Two feed pointers for one distinct changed document | 4 | 0 |
| Empty incremental feed page | 2 | 0 |
| 1,000 ordinary updates | 3,000 | 4,000 |

A normal save reads the target, receipt and collection head; it writes the target,
receipt, head and change pointer. Multi-document commands add effects, pointers,
heads, dependency receipts and planning reads. For a list page the model is
`1 + max(1, live query rows) + max(1, tombstone query rows)`. Queries fetch up to
`limit + 1`, so pagination may read more rows than that page returns. A feed page
costs `1 + max(1, pointer rows) + distinct changed documents`.

Assigning a sermon/group to a series additionally scans the owner's series inside
the transaction to enforce exclusive typed membership, including concurrent
assignments from different devices. Removal/reorder without new membership avoids
that scan. The planner bounds total distinct participants at 100 and refuses
`relation-scope-too-large` when it cannot prove the scope complete; it never accepts
a truncated uniqueness check. This is an additional relation cost, not an ordinary
three-read save. The emulator regression proves one ACK/one refusal for concurrent
assignments; it does not measure live billing or client security rules.

ACK responses include current related snapshots when available. Initial delivery
reuses the transaction's existing copies; replay adds one read per affected
document. Compact receipts still retain metadata only. If subsequent edits grow
the current copies past the 8 MiB effect-response budget, replay returns compact
ACK proof without those copies; a multi-document client must read them separately
before confirming its participant projections. The primary-plus-related size is
bounded here; this model does not count hosting bandwidth.

A new already-satisfied relation still advances its primary revision once so its
receipt names its own operation. It incurs the normal primary/head/pointer/receipt
writes; duplicate delivery of that same identity incurs none. Reusing an older
operation marker created an invalid replay receipt and is no longer permitted.

The current Standard-edition free allowance is 50,000 document reads, 20,000 writes
and 20,000 deletes per day for one database per project; it is shared by users and
all application paths. Storage allowance is 1 GiB. TTL deletes are outside free
usage. Verify project edition, plan and actual usage before treating this as an
available budget. [Firebase quotas](https://firebase.google.com/docs/firestore/quotas)

Empty queries have a minimum read charge. Listener reconnects and document changes
also consume reads; storage includes document and index overhead. The formulas
above deliberately exclude these rather than silently presenting them as zero.
[Firestore billing](https://firebase.google.com/docs/firestore/pricing)

**Consequence:** 5,000 ordinary saves already use 20,000 writes, before unrelated
application writes. Compact receipts reduce storage per save, not write count.
The default 750 ms autosave debounce reduces bursts of typing to saves; changing
it is a freshness/latency decision and must preserve immediate local durability.
No claim that whole-app operation stays inside free quota is currently justified.

## Mixed-version freshness costs

Legacy writers do not move the engine head. The previous implementation only
re-listed on navigation or explicit refresh; an open list could stay stale forever.
`CollectionReader` now schedules one sweep 15 seconds after the preceding request
settles, only while `legacyOpen`, watched, visible and online. All consumers in one
engine share it. Slow requests never overlap; failures back off up to 120 seconds;
head observations cannot bypass that backoff. Hidden/offline/unwatched readers
stop, and the sweep stops once a response establishes collection closure.

A mixed sweep lists directly, then catches up the feed from that list's anchor.
It does not first read the same feed redundantly. Closed collections remain driven
by the small head and incremental feed; the observer's fallback reads only that
head when no collection changes are reported.

Example steady-state model, one page, no tombstones, no changes, successful HTTP
fallback: with 20 live rows, a mixed sweep costs 22 list reads + 2 feed reads.
Four sweeps/minute plus four head checks/minute is about **100 reads/minute**,
or **6,000/hour per visible runtime**. With 50 rows it is about **13,200/hour**.
Multiple visible tabs/devices multiply this; cross-tab leadership is not implemented.
These are calculated scenarios, not live cloud invoices. Do not leave large domains
in mixed mode indefinitely or disable freshness silently to satisfy a budget.

Live proof: authorized test-account legacy HTTP create/update of QA council
`3b800de3-0b72-4d84-afdf-908796dcddd8` left the head at version 70 both times. The
already open localhost:3005 engine list acquired the row and its changed title
without navigation/refresh. Its browser visibility was `visible`. The legacy HTTP
writer was a script using the existing authorized test account; no browser state
or engine response was mocked. A separate-origin browser login did not complete,
so it was not used as evidence of a second device. The fixture remains for acceptance.

## Retention policy for the current protocol

- **Acknowledgement receipts: retain without TTL.** They are compact proofs rather
  than document history. The test stores 1,001 receipts after creation plus 1,000
  saves, each under 1 KB in that fixture, and proves an old replay has zero writes.
  There is no bounded client-offline horizon in protocol v1. Deleting a receipt can
  reapply an old operation after the document cycles back to its original value.
  A negative control that removed the receipt made that exact regression fail.
  Bounded retention requires a new enforced operation-admission/retired-epoch
  protocol and explicit recovery for expired intents; a timestamp alone is unsafe.
- **Conflict/refusal/dependency receipts: retain.** Exact results support recovery,
  and dependencies require proof of earlier acknowledgement. A conflict receipt can
  contain much more content than an ACK. Do not count every receipt as under 1 KB.
- **Heads and document tombstones: retain.** They fence generations, deletes and
  collection cursors. Deleting a parent does not safely retire its child history.
- **Change pointers: retain in this release.** Gap/reset handling already allows a
  full list rebuild, so bounded pointer retention is a future safe optimization
  candidate. It still needs a separately validated cleanup job, read-cost analysis
  for cold clients and deployed configuration. No cleanup job or TTL is enabled here.
- **Browser requests:** existing reference-aware transactional compaction retires
  clean acknowledged/cancelled payloads only after editor/manual/projection
  references are gone. Identity watermarks prevent dedupe reuse. Recovery source
  forks and legacy cache archives remain until a reviewed explicit retirement flow;
  age alone must not delete unfinished text or another tab's active work.

Firestore TTL is delayed, unordered and non-transactional; enabling it is a cloud
configuration change, not an application-code merge. It cannot stand in for the
proof conditions above. [TTL behavior](https://firebase.google.com/docs/firestore/ttl)

## Remaining operational acceptance

Before production activation, record the deployed rules release, production build
SHA, collection flags and expected active-device count. Run a fixed-duration session
covering idle foreground, typing, navigation, reconnect and two devices. Compare
Firebase Usage / billing deltas with the model, including existing non-engine
traffic; keep the measurement interval and baseline. Verify physical iPad and
installed PWA behavior separately. The instrumented tests and desktop browser proof
do not establish these cloud/device outcomes.
