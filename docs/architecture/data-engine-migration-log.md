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
| 3b | Councils writing, **whole**: create, update, delete and the two-council carry | 3a | Every council write runs through the engine, the carry as a registered core command; the conflict matrix is red before it is green | create, update and recovery verified live; delete and carry untested in a browser |
| 4 | Remaining council readers and legacy retirement | 3b | Hub, breadcrumbs, calendar and the pre-database localStorage carry-over; only then is the domain migrated | readers done; localStorage carry-over and legacy retirement left |
| 5 | Live browser proof for councils | 4 | Two windows, offline, reload mid-save: both edits survive; a conflict shows both versions | open |
| 6 | Core bugs surfaced by 3-5 | 5 | Each fix has a red check: disable the fix and the test fails | open |
| 7 | Receipt amplification | 6 | A thousand saves do not grow storage linearly (`app/data-engine/server.ts`) | open |
| 8 | Legacy queued council writes | 4 | A pending legacy write is discovered, shown and either replayed or exported | open |
| 9 | Rollout: rules, server flag, client flag | 7, 8 | An old PWA is refused and keeps its draft; owner presses the button | open |

Step 3b stands as follows, checked 2026-09-13: creating a council, renaming it,
adding and naming a section, and recovering unfinished work from an earlier page
load all run through the engine and were verified in a browser against the dev test
account. Deleting a council and carrying a section to another council have code and
tests on both sides — core command and client policy — but neither has been walked
through in a browser yet.

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

Point of no return: the first engine write to the production database in step 9.
Before it, rollback is one switch. After it, marked documents exist that legacy
writers cannot handle.

## Whole-app remainder: what is left before the engine runs the app

The queue above is **councils only** — the first domain and its rollout. This
section is the rest of the road, so that "how much is left" has one answer in one
place. Counts are measured, not estimated: exported functions in each legacy write
service, and the bypass ledger in
`frontend/__tests__/architecture/legacyFirestoreAccess.json`.

### Blockers that gate every domain

Nothing may be switched on in production while these stand.

| Blocker | Where | Why it gates |
|---|---|---|
| Receipt amplification | `app/data-engine/server.ts`, `BUG-20260912-engine-receipt-amplification` | Every acknowledged save stores a full document copy: ~1000 saves of a 500 KiB sermon ≈ 488 MiB of receipts |
| Four more core P1 defects | `BUGS.md` (`engine-ack-metadata-conflict`, `engine-successor-save`, `engine-manual-form-baseline`, `engine-local-retry`) | They break the ordinary save cycle, recovery and manual forms |
| Two core P2 defects | `BUGS.md` (`engine-collection-demand`, `engine-collection-cache-race`) | Reads continue after leaving a screen; a second tab's write reads as a lost deletion |
| Mixed-mode collection reads | `BUG-20260912-engine-collection-shows-deleted-legacy` | A legacy write raises no feed event, so a read-only crossover shows deleted rows. Reading and writing must move together, per domain |
| Manual Save forms | `app/data-engine/README.md`, manual scopes | Still being designed. Every domain with an explicit Save button waits for it |
| Rules not deployed | `frontend/firestore.rules` | Prepared marker rules exist but are not live; until they are, an old client can still write a migrated document offline |
| Legacy queued writes | `app/data-engine/legacyRecovery.client.ts` | Pending writes in `writeOutbox`, React Query paused mutations and the membership outbox must be discovered and settled before their domain's legacy path closes |
| No browser/device validation | — | Nothing has been proven in a genuinely foregrounded window, an installed PWA, or on a phone |
| No cost measurement | — | Reads and writes per session under the engine have never been measured against the Firestore quota |

### Domains

"Ops" counts exported functions in the domain's legacy write service — the surface
that has to move. "State" is what exists today, measured by imports, not by intent.

| Domain | Ops | State today | What it still needs |
|---|---|---|---|
| Councils | 6 | List read through the engine (done, unshippable alone); `council-carry` registered in the core; `EngineCouncilCreator` written and unwired | Client half of writing: domain policy for the carry, document adapter, council and conduct screens, wiring the creator, then the readers in step 4 |
| Sermons | 33 | Partially on the engine: core fields and scratch wired; `useSermonThoughtsDataDocument` written but **imported by no screen**; eight controls inert behind the switch (`page.tsx`, `legacyReadOnly`) | Wire thoughts; adapters for outline, structure, plan, preach dates and the AI writers; un-inert the eight controls. Largest domain, last in order |
| Groups | 11 | Untouched. Carries two of the five audited losses (meeting array online and offline) | Full adapter and screens; the meeting array is the same ID-item class as council topics |
| Studies (notes + materials + share links) | 7 | Untouched; the note editor is the most complete legacy example of the contract | Full adapter; `material-notes` relation already exists in the core; share links need an ownership decision |
| Series (+ membership) | 6 + 6 | Untouched; `series-membership` relation already exists in the core | Full adapter; its own outbox must be retired with it |
| Prayers | 9 | Untouched | Full adapter; the answer/update journal is another embedded array |
| Service orders | 13 | Untouched; already has HTTP + CAS and its own freshness | Full adapter; placement is a bounded multi-document operation and may need its own command |
| Plan templates | 5 | Untouched | Full adapter |
| User settings | 18 | Untouched; also written by privileged server paths (usage, tier, referral) | A trusted protected-field policy so metering does not break |
| Tags | 4 | Untouched; active delete already guarded | Custom-tag commands must preserve required-tag restrictions |
| Prayer categories | — | Untouched | Small adapter |
| Calendar / care views | — | Read-only projections over the domains above | Follows whatever its underlying domains do |

Total legacy write surface: **118 exported operations across 11 services**, none
retired yet. Bypass ledger: **125 SDK calls, 230 runtime imports, 29 legacy HTTP
writes** — the number that has to reach zero.

### After the last domain

Retire the legacy layer itself: `conflictSafeUpdate.client.ts` (493 lines),
`writeOutbox.client.ts`, `outboxReplay.client.ts` and the React Query
`mutationDefaults.ts` write paths, then turn the architecture gate from a shrinking
budget into a hard zero.

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


### 2026-09-12 — Step 3b, client half begins: the mark becomes the command

Owner redirected the order of work: stop deepening the core and get the branch to a
state someone can pull, run locally and actually click through. That is the right
call on the evidence — both of today's most valuable defects were found in a browser
while every test was green, and this repository already holds a warning about growing
a layer without a live consumer (`useSermonThoughtsDataDocument`: written, tested,
imported by nobody). The plan is unchanged; the priority inside it is: finish the
councils domain end to end, switch it on locally, and repair whatever the live run
surfaces — including core defects — rather than repairing them in advance.

`domainPolicy.ts` now turns a carried mark into the two-council command. The screen
marks one topic as carried to council X and saves; `requiredDomainTargets` names the
destination so the engine reads its snapshot itself, and `prepareCarry` builds both
edits. The copy that lands in the destination derives its identifiers from the
operation id: `copyTopicForNext` uses random ones, and a replay after a lost
acknowledgement would then leave the destination holding the section twice.

Refused: a destination the engine could not confirm, a deleted destination, one
owned by someone else, carrying into the source council itself, and more than one
section in a single save. Ordinary editing claims nothing and stays a plain update.

Nine policy tests, three red for the right reason first. Gates: `test:fast` 6635
passed / 6640, `tsc --noEmit` exit 0, `lint:full` exit 0.

**Next, in this order:** the council document adapter (update, delete, carry through
the public interface), the council and conduct screens, wiring
`EngineCouncilCreator`, then switching councils on locally and clicking the whole
cycle — create, type, carry, delete, offline, reload, two windows.

### 2026-09-12 — Step 3b: councils wired end to end; create works, editing does not yet

The whole domain is now wired behind the switch: `useCouncilDataDocument` (update,
delete, carry through the public interface), the council screen and the conduct
screen branch the way the sermon page does, and `EngineCouncilCreator` is wired into
the list. With `councils` enabled on both sides, creating a council **works through
the engine end to end** — verified live at localhost:3005 as the dev test user: two
councils were created, each landed in the database carrying the protocol marker at
revision 1, and the screen navigated to the new council's page. A legacy council
without the marker sits beside them, which is the mixed state the migration expects.

**Two defects of mine, both found in the browser with every test green.**

- The creator submitted before the editor existed. `useDataDocument` opens
  asynchronously; the mock in its test was always ready, so nothing was created and
  nothing failed either. Fixed by waiting for readiness, with a test that was red.
- Readiness flips while the create is in flight, so the effect re-ran and its cleanup
  cancelled the report — the screen never learned the council existed, its form stayed
  half-open and the button died. Fixed by tying the pending answer to the council id
  and the component's life rather than to one run of the effect; the reproducing test
  was red first.

**What does not work yet, stated plainly.** Editing does not reach the database:
neither renaming a council nor adding a section changes the stored document (revision
stays 1). The screens call the adapter as fire-and-forget (`void document.update…`),
so a refusal disappears silently — nobody, including me, sees why. The next step is to
surface that failure first (show it through `DataSyncStatus` and a toast), then fix the
cause it reveals. Carrying a section could not be exercised because it needs an edited
source council.

Gates: `test:fast` 6644 passed / 6649, `tsc --noEmit` exit 0, `lint:full` exit 0.

**Left in the dev test account:** two councils carrying the engine marker, "ENGINE A
istochnik" and "ENGINE B naznachenie". Their legacy write path is refused by the
marker guard, so they should be removed through the engine once editing works, or
deleted directly in the database.

### 2026-09-13 — Step 3b: editing reaches the database; the refusal that hid it is gone

**Editing a council now works end to end through the engine**, verified live as the
dev test user with councils enabled on both sides: renaming a council, adding a
section and naming it all reached the database at revisions 2, 3 and 4.

**What was wrong, and why it stayed hidden.** The carry guard compared the whole
`topics` array, so adding or removing a section read as a claim that a section had
been carried to another council — and the screen adds an empty section which the
person names afterwards. Every edit was refused with `relation-command-required`.
That was the third time in this work that a guard written against a field name
turned out wider than its meaning; the rule is now to compare the meaning of the
change, not the shape of the field.

It stayed hidden because the screens called the adapter without awaiting, so the
rejected promise had nowhere to land: the council simply stopped saving while the
screen looked fine. Both council screens now mount the shared `DataSyncStatus` and
report refusals. Making the failure speak is what produced the diagnosis — the
banner said "the server refused the change" and the probe then named the code.

**Found while doing this, and filed rather than fixed:**
`BUG-20260913-engine-refused-draft-lost-on-reload` — a refused edit disappears after
a reload while the banner says "Saved", although the banner itself promises the draft
was kept. That is a text-loss defect of exactly the class this whole engine exists to
remove, and it is the next thing to fix.

**Not verified live:** carrying a section to another council. Its core command and
its client policy have tests, but the button only appears on a council that has been
held, and that path has not been walked in a browser yet.

Gates: `test:fast` 6644 passed / 6649, `tsc --noEmit` exit 0, `lint:full` exit 0.

### 2026-09-13 — Unfinished work is findable again

A page load gives the editor a new identity (`browser.client.ts` derives it from the
tab), so an edit left behind by an earlier load belongs to no editor and never
appears. The text was never lost — both of yesterday's refused edits were still on
disk — but there was no way to reach them, and the banner said "Saved".

The engine already solves this properly: it offers unfinished work rather than
applying it silently, which is right, because another tab's text must not appear
under your cursor. The sermon workspace used that offer; the council screens did not.
`useCouncilDataDocument` now exposes `listRecoverable`/`recover` with a title and a
preview built from the draft's sections, and both council screens pass them to the
shared banner.

Verified live: after a reload the council screen found both drafts left from the
previous session, and restoring one brought its section back into the editor. The
server then refused that restored draft because it was built on revision 1 while the
document had reached revision 4 — correct behaviour, stated plainly by the banner,
with the text kept for the person to decide.

What remains is narrower than the original report, and the tracker entry was rewritten
to match: the banner still reads "Saved" while unfinished drafts sit beside it, so the
work is findable only by pressing the button blind
(`BUG-20260913-engine-idle-banner-hides-unfinished-work`, P2).

Gates: `test:fast` 6645 passed / 6650, `tsc --noEmit` exit 0, `lint:full` exit 0.

### 2026-09-13 — Carrying and deleting proven against the live server

Conducting a council runs through the engine: the council moved to `held` with its
time recorded, revision 4 to 5.

**Carrying a section changes two documents in one operation.** Sent against the
running server: the source's section gained its "carried to" mark (revision 5 to 6)
and the destination gained the copy (revision 1 to 2). There is no in-between state
where the section sits in both councils or in neither.

**A replay is harmless.** The identical command was sent twice; both answers were
acknowledgements, and the destination ended with two sections rather than three. The
copy's identifiers come from the operation id, so a lost answer costs nothing — which
is the property the random identifiers of `copyTopicForNext` could not give.

**Deleting leaves a tombstone.** Both test councils were deleted through the engine:
the stored value is gone but the record remains marked deleted, so a late write from
another device cannot resurrect them.

**Not proven: the carry button itself.** The command was sent directly rather than
through the screen, because the dev-server Fast Refresh did not pick up an added probe
and this tab's console returned nothing, so the wrapper could not be observed. The
button's own path — which council the screen picks when several are being prepared,
and what it shows afterwards — still needs a browser pass.

Cleanup: both engine-marked test councils were removed; the account's own
"QA совет с секциями" was left untouched.

Gates: `test:fast` 6645 passed / 6650, `tsc --noEmit` exit 0, `lint:full` exit 0.

### 2026-09-13 — Every council reader now goes through one door

The care hub, the breadcrumbs, the calendar and the council screen each read the
list separately, and three of them were still on the legacy road while the domain
moved. A reader left behind shows a council that was deleted, and the person cannot
tell which screen is lying.

`useCouncilsRead` is now that one door: it picks the source once, and no screen
carries its own branch. Hooks cannot be called conditionally, so it calls both and
returns the migrated one — the extra list read ends when the legacy hook retires
with the domain.

For that to be possible, `useDataCollection` had to stop throwing without a
provider. The distinction is by the meaning of the failure: for a document editor a
missing provider is a programming mistake and still throws, but for a collection
read from a screen that also runs without the engine it is simply an absence of
rows. A test covers the idle case, and the strict boundary keeps its own test.

Verified live with councils enabled: the hub counts "Советов в подготовке: 1", the
calendar shows the council on its date, and the breadcrumbs read
"Дела сердечные / Братский совет / QA совет с секциями" — all through the engine,
against the account's own council, with no test data of mine left in the database.

Gates: `test:fast` 6646 passed / 6651, `tsc --noEmit` exit 0, `lint:full` exit 0.

Still open in this domain: the pre-database localStorage carry-over, retiring the
legacy hook, and a browser pass over the carry button itself.
