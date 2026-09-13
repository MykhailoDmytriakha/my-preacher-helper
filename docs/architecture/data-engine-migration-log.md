# DataEngine migration — working queue and closing log

Started 2026-09-12 on branch `data-engine`, worktree `2767/my-preacher-helper`,
baseline commit `35abc917`. This file is the hand-off record: what is being
migrated, in which order, what is already closed and with which evidence.

## How this relates to the existing documents

- [`data-engine-proposal-2026-09-12.md`](./data-engine-proposal-2026-09-12.md) — the architecture and why B was chosen. Unchanged.
- [`data-engine-implementation-plan.md`](./data-engine-implementation-plan.md) — the original ten-item delivery plan. Items 1-3 are closed there; this file continues from item 4.
- [`data-engine-remaining-admin-writers.md`](./data-engine-remaining-admin-writers.md) — the staged legacy-writer boundary. Still current.
- [`../audits/2026-09-12-sync-mechanisms-context.md`](../audits/2026-09-12-sync-mechanisms-context.md) — the audit that reproduced five data-loss scenarios.

## Verified state at the time this log was opened

Measured, not quoted from the documents above:

- Engine module: 34 files, 5984 lines; 619 direct tests green plus 5 emulator
  tests green against a live Firestore emulator on port 8188.
- Production consumers: the sermon page only — core fields and scratch.
  `useSermonThoughtsDataDocument` exists, is tested, and **no screen imports it**.
- Both switches are off: `NEXT_PUBLIC_DATA_ENGINE_ENABLED` (`app/data-engine/react.client.tsx`)
  and `DATA_ENGINE_ENABLED` (`app/data-engine/server.ts`).
- None of the five audited loss scenarios is fixed: `mergeScratch.ts`,
  `groups.service.ts`, `useCouncils.ts`, `councils.service.ts`,
  `atomicUpdate.client.ts` are byte-identical to `main`.
- The legacy boundary is server-only (`firebase-admin`); all five live losses are
  client-side, so the boundary does not cover them.
- Migration debt ledger (`frontend/__tests__/architecture/legacyFirestoreAccess.json`):
  125 SDK calls, 230 runtime imports, 29 legacy HTTP writes.

## Why councils is the first domain

- It carries two of the five audited losses (conflict drops local text; offline
  confirms a queue without a result).
- It has nested ID-bearing items (`topics`), which is the exact class the protocol
  was built for, so it is representative.
- It has **no manual Save form** — the screens use `LiveTextInput`/`LiveTextArea`
  autosave. The engine's manual-scope support is still being designed, so the
  first domain deliberately avoids the least mature part of the core.
- It is small: 4 client operations against 33 for sermons.

## Working rule

One queue item at a time, each through the full cycle: gather context, decide,
plan, implement with a failing-first test, validate (unit tests, full `test:fast`,
`tsc --noEmit`, lint, and a real browser run against the local dev server signed
in as the dev test user), then close it here with evidence before taking the next.
A closing entry must state what changed, what proves it, and what stays unproven.

## Queue

| # | Step | Depends on | Acceptance | Status |
|---|---|---|---|---|
| 1 | Per-collection activation switch | — | With only `councils` enabled, the sermon page still renders every legacy control | closed |
| 2 | This migration log | — | File exists in git and is updated at every closing | closed |
| 3a | Councils list **read** through the engine, on the list screen | 1 | The list screen renders the same councils through the engine behind the switch; verified in a browser | closed |
| 3b | Councils writing, **whole**: create, update, delete and the two-council carry | 3a | Every council write runs through the engine, the carry as a registered core command; the conflict matrix is red before it is green | open |
| 4 | Remaining council readers and legacy retirement | 3b | Hub, breadcrumbs, calendar and the pre-database localStorage carry-over; only then is the domain migrated | open |

**Writing cannot be split, and reading cannot ship before it.** Two findings from
step 3b's first attempt, both grounded:

- An engine-created council carries the protocol marker, so the council screen's
  legacy update is refused (409 on the server, rules offline). Creating without
  editing would hand the person a council they cannot type in. Editing in turn
  needs the carry-over, which writes two councils at once and cannot be split into
  two independent writes without losing its atomicity — so it needs a registered
  relation command in the core. Create, update, delete and carry are one piece.
- Reading alone is not shippable either: see
  `BUG-20260912-engine-collection-shows-deleted-legacy`. While a legacy writer
  still owns the collection, its writes raise no feed event, so the engine's cached
  list keeps showing a council that was deleted. Step 3a's code stands, but its
  switch must not be turned on until writing moves with it.

Each slice is deliberately cut to run through every layer — storage, engine,
hook, screen, browser — rather than finishing one layer at a time. Reading comes
before writing because the protocol marker is written only by an engine write
(`app/data-engine/server.ts`), so a read-only slice changes no stored document
and stays reversible by the switch alone. The carry-over
between two councils is separated because it is not an adapter at all: the core
knows only `material-notes` and `series-membership` relations, so a third one has
to be registered there, and the core still has five open P1 defects. Mixing that
risk into ordinary CRUD would make a failure impossible to attribute.
| 5 | Live browser proof | 4 | Two windows, offline, reload mid-save: both edits survive; a conflict shows both versions | open |
| 6 | Core bugs surfaced by 3-5 | 5 | Each fix has a red check: disable the fix and the test fails | open |
| 7 | Receipt amplification | 6 | A thousand saves do not grow storage linearly (`app/data-engine/server.ts`) | open |
| 8 | Legacy queued council writes | 4 | A pending legacy write is discovered, shown and either replayed or exported | open |
| 9 | Rollout: rules, server flag, client flag | 7, 8 | An old PWA is refused and keeps its draft; owner presses the button | open |

Point of no return: the first engine write to the production database in step 9.
Before it, rollback is one switch. After it, marked documents exist that legacy
writers cannot handle.

## Closing log

Newest last. Every entry: what changed, what proves it, what stays unproven.

### 2026-09-12 — Step 2: migration log opened

Created this file so the queue and its evidence survive the session that produced
them. No production code changed.

### 2026-09-12 — Step 1: activation became per collection

**Why this had to come first.** Activation was one process-wide boolean, so
enabling the engine for a migrated domain would also have routed every unmigrated
one through it. On the sermon page that meant eight deliberately disabled controls
(`page.tsx`, `legacyReadOnly`): turning on councils would have broken sermons.

**What changed.**

- `app/data-engine/react.client.tsx` — `isCollectionOnEngine(collection)` reads
  `NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS` (comma separated). `isDataEngineEnabled()`
  now answers only "does this workspace need a live engine at all", which is true
  when at least one collection is listed. The older all-or-nothing
  `NEXT_PUBLIC_DATA_ENGINE_ENABLED=true` still means every collection, so no
  existing contract changed.
- `app/data-engine/server.ts` — `assertDataEngineEnabled(collection?)` honours
  `DATA_ENGINE_COLLECTIONS`; without a collection it only answers whether the
  protocol is served at all. `commandCollection(body)` safely extracts the
  collection a command names, because the command route gates before validation.
- The four engine routes pass their own collection. The command route gates twice:
  the protocol first, then the collection its body names.
- `sermons/[id]/page.tsx` asks `isCollectionOnEngine('sermons')` instead of the
  global flag.

Client and server lists stay separate on purpose: the rollout order is server,
then rules, then client, and a client build must never be able to widen the
server's surface.

**Evidence.**

- New behavioural tests, both red before the change for the right reason
  (`false` where `true` was required; `503` where `200` was required):
  `app/data-engine/__tests__/react.client.test.tsx` "routes only the listed
  collections through the engine" and `__tests__/data-engine/routes.test.ts`
  "serves only the collections this deployment migrated".
- Mutation check: making `isCollectionOnEngine` ignore the collection name turns
  the client test red on `sermons`, so the test guards behaviour, not existence.
- Full gates from `frontend`: `test:fast` 6616 passed / 6621 (was 6614 / 6619),
  `tsc --noEmit` clean, `lint:full` 0 errors (13 pre-existing warnings).
- Regression found and fixed by the full run: the blanket
  `jest.mock('@/data-engine/react.client')` in
  `__tests__/pages/sermons/SermonPage.modeTransitions.test.tsx` lacked the new
  export, so 20 tests failed. The mock was repaired rather than the page given a
  fallback. The other five blanket mocks of this module were checked and are
  unaffected: none of their modules calls the new function.
- Live browser run, dev server on port 3005 signed in as the dev test user, with
  `NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS=councils` and `DATA_ENGINE_COLLECTIONS=councils`:
  the sermon page rendered every legacy control (recording, idea, structure editor,
  distribute thoughts, sermon plan, mode switches); `/api/data-engine/collections/councils`
  and `/api/data-engine/documents/councils/probe-id` answered 200 while the same
  routes for `sermons` answered 503; the console had no errors or warnings; the
  engine's IndexedDB stores (`preacher-data-engine-v1`) were created, proving the
  provider mounted.

**Unproven.** No production deployment, no rules change, no second device, no
installed PWA, and no cost measurement. Councils still runs on its legacy path:
this step only made it possible to migrate one domain without disturbing another.

### 2026-09-12 — Step 3a: the council list reads through the engine

**Scope, and why it is this small.** Only reading, and only the list screen. The
protocol marker is written by an engine write (`app/data-engine/server.ts`), so a
read-only slice leaves every stored council exactly as the legacy road left it and
the switch alone reverses it. Writing, and the two-council carry-over that needs a
new relation command in the core, are separate queue items.

**What changed.**

- `app/hooks/useCouncilsDataCollection.ts` — the list taken from the shared
  collection. Tombstones and confirmed absences are filtered out for the view while
  the engine keeps knowing about them; shaping reuses `hydrateCouncil` from the
  legacy road rather than a second copy of that rule; `complete` and `freshness`
  are surfaced so an incomplete offline cache is never presented as "no councils".
- `care/council/page.tsx` — the same branch pattern the sermon page uses:
  `EngineCouncilListPage` and `LegacyCouncilListPage` around one
  `CouncilListContent`. The legacy path is unchanged. The engine page still takes
  `createCouncil` from the legacy hook: that is a deliberate, temporary seam which
  step 3b removes, and it costs one extra list read while the switch is on.
- `CouncilListSource` names what the screen needs from a reader, so it no longer
  depends on React Query's result type. `tsc` found that; the tests did not.
- `app/data-engine/server.ts` — `_dataEngineHeads` is exempt from the per-collection
  list. It is the engine's own bookkeeping, not a migrated domain, and gating it
  left a client enabled for one collection unable to learn that its own collection
  had changed.

**Evidence.**

- Five adapter tests, four of them red for the right reason against a shell
  implementation; seven screen tests, and a mutation (engine branch reading the
  legacy list) turns the screen test red, so it guards the branch and not its
  own existence.
- The `_dataEngineHeads` regression was found **in the browser**, not by the gates:
  the screen said the councils could not be read while every test was green. Its
  fix has a test that was red (503 where 200 was required) before it.
- Gates from `frontend`: `test:fast` 6623 passed / 6628 (was 6616 / 6621),
  `tsc --noEmit` exit 0, `lint:full` exit 0 with the 13 pre-existing warnings.
  The four legacy council suites stay green at 47 tests.
- Live run at localhost:3005 as the dev test user with councils enabled on both
  sides: a council created through the **legacy** road appeared in the list served
  by the engine, under "preparing", with the engine's own HTTP calls returning 200.
  The test council was deleted afterwards; the account's collection is empty again.

**Correction, found the next day of work.** This slice is complete as code but is
**not shippable on its own**: while the legacy road still writes councils, its
writes raise no feed event, so the engine's cached list keeps showing a deleted
council. Measured: the server returned `snapshots: []` while the browser cache
held one row and the screen drew it. Tracked as
`BUG-20260912-engine-collection-shows-deleted-legacy`. The switch for councils
stays off until writing moves too.

**Unproven, and one limit of the harness.** The automation tab is always
`visibilityState: 'hidden'`, and the engine deliberately does not read collections
for a hidden tab — that is its read-budget policy, not a defect. Visibility had to
be emulated for the render to happen, so the list was verified with an emulated
visible document, not a genuinely foregrounded window. Nothing about
writing, conflicts, offline behaviour or a second device is claimed by this step.

### 2026-09-12 — Step 3b, first attempt: the creator exists, the slice does not

`care/council/EngineCouncilCreator.tsx` creates one council through the public
interface: the screen makes the client id, this owns the lifecycle, `commit` with
autosave off freezes the whole intended value, the stored fields never carry the
id, and one council is submitted exactly once even across re-renders. Four tests,
three red for the right reason first. It is **not wired to any screen**.

It is not wired because wiring it alone would break the domain: an engine-created
council is marked, and the council screen still edits through the legacy road,
which a marked document refuses. Following that thread showed the carry-over needs
a core relation command, and reading showed its own mixed-mode defect. The queue
above now carries one whole writing step instead of three.

Gates after this work: `test:fast` 6627 passed / 6632, `tsc --noEmit` exit 0,
`lint:full` exit 0. Verified live at localhost:3005 that the council section still
behaves exactly as before, since nothing on screen changed.

### 2026-09-12 — Step 3b, core half: carrying a section is a registered command

`council-carry` now sits beside `material-notes` and `series-membership`: the type
(`types.ts`), the gate (`protocol.ts`, exactly two councils, both in the councils
collection, the first edit being the command's own resource), and the execution
(`serverRelations.ts`, three-way merge of `topics` per side against the live
document). A stale generation on either side refuses the whole command with no
partial write.

**A guard I had to narrow, found by walking on rather than by a test.** The first
version forbade every ordinary update of `councils.topics`, which would have turned
each keystroke in a section into a two-council operation. Editing a section is
ordinary work; only the carry **mark** — a claim that another council received the
section — belongs to the two-council command. `carryMarks` compares just that part
of the array, so typing stays an ordinary update and a claim about another document
does not.

Five tests, four red for the right reason first. Gates: `test:fast` 6632 passed /
6637, `tsc --noEmit` exit 0, `lint:full` exit 0.

**Where this step stands.** The core half is done. The client half is not: the
domain policy (`domainPolicy.ts`) turns an edited draft into a command and today
knows how to build a one-resource series relation and a material relation whose
targets the engine reads itself. The carry needs the same treatment — the source's
draft carries the mark, and the destination is the second edit, its generation read
inside the engine, never supplied by the screen. After that come the council screen,
the conduct screen, wiring `EngineCouncilCreator`, and only then the switch.

