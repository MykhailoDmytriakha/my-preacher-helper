# DataEngine migration — working queue and closing log

Started 2026-09-12 on branch `data-engine`, worktree `2767/my-preacher-helper`,
baseline commit `35abc917`. This file is the hand-off record: what is being
migrated, in which order, what is already closed and with which evidence.

## Read this first — where the work stands on 2026-09-19

**Active continuation, 2026-09-19 (Codex).** Resumed from clean `62dde054` after the
Opus/Fable hand-off. Production readiness is still open. The current local work
prioritizes shared data safety before more domain adapters. Progress is also tracked
by `el` in this worktree, case `2026-09-19-data-engine-production-readiness`.

Current hard-path checkpoint: atomic queue ownership is committed as `61104b4b`;
legacy series preservation is committed as `ea536555`. Pinned membership stages,
CAS storage and the public `useDataMembership` hook are committed as `9abeede6`,
with crash/retention regression proof and a successful isolated production build.
The checkpoint passed final coverage/review recording. Cascade write-set activation
guards are committed as `c699ae74`. Whole-action discard now owns every participant
and dependent request in one local transaction; validation is recorded below.
Public delivery/retry/discard controls are committed as `eda634e2`. Series list
readers and durable creation are committed as `1b6a2bab`. Series detail now uses
the public engine for metadata, deletion and pinned assign/remove/reorder stages.
Workspace-wide membership recovery and group/sermon-menu entry points are committed
as `1b8d2bce`. The existing-sermon edit field now uses a pinned engine scope too.
Creation with membership, sermon backlinks and live acceptance still block activation.
Atomic create-and-link is committed as `de572d6a`; its durable stage/public API is
committed as `c90ad88a`. `EngineCreateSermonModal` and workspace recovery now consume
that API, with **724 suites / 7201 tests** passing. Remaining immediate work:
replace dashboard/list/series-selector creation entry points together with their
canonical sermon collection reads; preserve old cache/mutation input before that
switch, and support durable preselected-series intent. No entry-point rollout yet.
Groups/series activation stays blocked. No production deployment or switch changed.

- Reproduced `BUG-20260919-engine-field-buffer-diverges`: the focused text field
  hid remote content already accepted by the engine; blur could also discard a
  keystroke before its local echo. Six tests failed before the fix and pass now.
- Added a shared presentation-only text buffer: it retains unacknowledged local
  keystrokes, then follows the owning document even while focused. No conflict or
  transport policy moved into the field.
- The council decision now stages each keystroke through the same document writer
  as other council fields. Its component no longer sends a last write during
  cleanup, after its parent editor may already have closed.
- The Markdown editor shares that buffer, no longer schedules stale content
  replacement, and renders incoming content with `emitUpdate: false`. TipTap 3
  otherwise emits a write callback for programmatic content replacement:
  https://tiptap.dev/docs/editor/api/commands/content/set-content .
- Recovery discovery now runs automatically through the public React engine API.
  It projects terminal durable request results using the same `DataSession.applyCommit`
  rule as mounted editors, excluding already-delivered saves while preserving later
  unsent typing. Owner changes and overlapping discovery responses are fenced.
  The saved banner explicitly mentions outstanding recovery choices. Source records
  remain untouched: this is a projection, not cross-tab garbage collection.
- A live conflict test exposed `BUG-20260919-engine-conflict-local-failure`:
  navigation reused an editor ID after its clean checkpoint had been compacted.
  Its restarted edit counter collided with the completion watermark. Browser editor
  IDs now allocate a fresh lifetime on every opening; deduplication remains intact.
  An integration regression uses actual checkpoint/commit adapters with the
  transactional storage harness and fails before the fix with the exact browser error.
  The React facade also now exposes asynchronous controller storage errors.
- Current automated evidence after lifecycle/error fixes: 696 suites / 6963 tests
  green (2 suites / 5 tests intentionally skipped), TypeScript green, lint 0 errors /
  15 inherited warnings. Logs: `/tmp/data-engine-{full-tests-4,lint-4,types-4,revisit-before,revisit-after,error-before}.log`.
- Live Chrome, localhost:3005, existing test account, disposable council
  `761c359b-7477-4e6a-a8de-57044b7cf26b`: focused title accepted the other tab's text;
  decision typing followed immediately by navigation survived reopening and appeared
  in the second tab; reload automatically offered the unfinished second draft;
  explicit recovery retained its title and exposed the conflict choices; keeping that
  draft, navigating to the list, reopening and saving `QA save after navigation verified`
  succeeded and appeared in both tabs. No visibility
  emulation was used (`document.visibilityState` was `visible`). This is development
  browser evidence, not installed-PWA or physical-device acceptance.
- Current review scope: changes since `62dde054`; sequential lanes cover ownership,
  races/retention, public boundaries, behavior regressions and error handling. The
  boundary detector caught an internal recovery import; the consumer now uses the
  public React facade and the detector remains unchanged.
- Review conclusion for this checkpoint: no remaining high-confidence regressions
  in the changed paths after the lifecycle repair. No independent agent was used.
  `origin/main` was fetched on 2026-09-19; `HEAD..origin/main` is empty.
- Checkpoint one is committed as `962d3fcf` (editor lifetimes and recoverable work).
- Held-council outcome forms now use `useDataForm` inside the shared page provider.
  Opening pins selected outcome fields; typing remains durable but unsent; Save
  compares against that ancestor. The form has its own status and recovery discovery.
  Live before: B silently overwrote A. Live after: B retained its text and exposed
  the common conflict choices while A stayed saved on the other tab.
- A second regression showed explicitly cancelled manual intent returning on reopen.
  Cancellation now emits a terminal queue event, clean inactive scopes compact on
  ACK or cancellation, and recovery reads fresh durable request state. Later unsent
  typing is still retained. Tests failed before these changes and pass after.
- Live restart proof on the same disposable council: `QA manual restart retained`
  survived reload, appeared as a recovery preview, and was restored only by choice.
  The other tab still showed `QA pinned final A` until explicit Save; afterwards both
  showed the restored value. The test fixture remains available for acceptance.
- Current gates for the manual-form checkpoint: **697 suites / 6970 tests pass**
  (2 suites / 5 tests skipped), TypeScript passes, lint 0 errors / 15 inherited warnings.
  `npm run build` with the councils switches passes in an isolated copy, including
  the production service worker. First sandboxed attempt could not fetch Google
  Fonts; the network-enabled repeat passed. `npm run test:rules` passes **256 + 5**
  emulator checks. Logs: `/tmp/data-engine-manual-{full-2,lint-2,cancel-before,retire-before,retire-after}.log`,
  `/tmp/data-engine-production-build-network.log`, `/tmp/data-engine-rules.log`.
  Sequential review covered selection boundaries, pinned ancestry, owner fencing,
  cancellation, recovery, public imports and actual screen wiring; no independent
  agent reviewed this checkpoint. No high-confidence regression remains in its diff.
- Manual-form checkpoint committed as `e201ed58`.
- Legacy council query-cache copies now archive **before** QueryProvider mounts,
  including expired caches. Failure retains the original cache and gates startup with
  Retry. The current owner can inspect/export preserved copies; no copy is automatically
  merged or submitted. Content deduplication retains distinct old/new drafts.
  Browser proof used a real legacy UI save refused with HTTP 400: its
  `QA legacy refused copy preserved` text appears in the archived record after enabling
  the engine, while the actual document still says `QA manual restart retained`.
  The archive UI says copies may be stale rather than claiming they are unsaved edits.
- Bypassing the pre-hydration gate makes the provider regression fail. Current tests:
  **699 suites / 6978 tests pass**, 2 suites / 5 skipped; types pass, lint 0 errors /
  15 inherited warnings. Councils-enabled production build also passes:
  `/tmp/data-engine-production-build-legacy.log`. Other logs:
  `/tmp/data-engine-legacy-{full,lint,gate-negative,gate-after}.log`.
  Review checked failure ordering, cross-account reads, preservation idempotence and
  zero automatic delivery; runtime boundaries still pass without new exceptions.
- Rollout order is corrected below: protective marked-document rules precede engine
  writes; collection-wide closure remains last. No cloud deployment was performed.
- Legacy cache preservation checkpoint committed as `4457af7b`.
- Operating-budget checkpoint: shared collection readers now sweep mixed collections
  every 15 seconds after the previous request settles. Sweeps coalesce consumers,
  suspend offline/hidden/unwatched, back off on errors, and stop on closure. A head
  observation cannot bypass backoff; mixed hydration avoids a redundant feed read.
- Live proof: an authorized legacy HTTP writer created and renamed QA council
  `3b800de3-0b72-4d84-afdf-908796dcddd8` while the engine list stayed open. Both changes
  arrived without navigation; the engine head stayed at 70. This proves the actual
  legacy API/browser path, not a second physical device or production PWA.
- Protocol instrumentation proves ordinary saves cost 3 document reads / 4 writes,
  duplicate delivery 2 / 0, and 1,000 saves 3,000 / 4,000 before retries and other
  traffic. Receipt-expiry negative control re-applies an old edit after a value cycle:
  acknowledgement proofs must not get TTL under the current unbounded offline contract.
  Read `data-engine-operations.md` for the full model and remaining cloud measurements.
- Current gates: **699 suites / 6987 tests pass**, 2 suites / 5 tests skipped;
  types pass, lint 0 errors / 15 inherited warnings. Councils-enabled production build
  passes (`/tmp/data-engine-production-build-operating.log`). Tests/logs:
  `/tmp/data-engine-operating-{full,lint}.log`, `/tmp/data-engine-mixed-budget-2.log`,
  `/tmp/data-engine-server-budget-final.log`. Sequential review covered timer ownership,
  generation fencing, request amplification, replay semantics and documentation;
  no high-confidence regression remains in this diff. No independent agent reviewed it.
- Operating-budget checkpoint committed as `5fe1b629`.
- Group checkpoint: detail, creation, manual conduct, recovery, read projections,
  legacy preservation and pre-transport refusal now pass **705 suites / 7020 tests**,
  TypeScript and lint (0 errors, 15 inherited warnings). Isolated production build
  with councils/groups enabled passes after supplying the existing local environment
  in memory; the first isolated attempt lacked Firebase configuration. Logs:
  `/tmp/data-engine-groups-final-{tests,lint}.log`, `/tmp/data-engine-group-types.log`,
  `/tmp/data-engine-production-build-groups.log`. Live conduct reached saved status,
  and the already-open list adopted its 7-minute duration.
- Shared submitted-work checkpoint: navigation/restart retain queued creation and
  updates. Lists project local intent separately from confirmed snapshots; pending
  deletion remains addressable. Logout clears the list, and the canonical session
  rule preserves independently merged ancestor fields. Full fast gate: 710 suites /
  7,049 tests. Lint/types pass; full coverage passes at 92.05% lines. Details at the end of this file.
- Series exclusivity now rejects concurrent assignment of the same typed member
  to two series, including initial creation. Five actual emulator tests pass; the
  explicit opt-in is preserved by Jest setup. Group activation is still blocked on
  compatible series clients and atomic move/recovery handling.
- Next: migrate series membership, series CRUD and their readers. Group editing,
  creation, manual conduct and reads are implemented but remain off in production.
  Remaining domain rows, recovery lifecycle, cloud cost/retention measurement,
  protective rules rollout and physical-device acceptance remain outstanding.

The earlier decision to treat a focused field hiding accepted remote content as
harmless is withdrawn: its next keystroke can overwrite the remote value without
a conflict. The regressions above establish why this must be fixed before rollout.

**Inherited deployment state (not re-inspected in this continuation):** engine switches
were off in Production and prepared rules were not deployed. This continuation has
not pushed or deployed anything. Preview uses the production database; see below.

**Preview: councils run on the engine.** Branch alias
`https://my-preacher-helper-git-data-engine-mykhailos-projects-97382f6c.vercel.app` (Vercel
sign-in in front of it). Three variables are set for **Preview · branch `data-engine` only**:
`NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS=councils`, `DATA_ENGINE_COLLECTIONS=councils`,
`NEXT_PUBLIC_ENABLE_TEST_LOGIN=true`. Google sign-in does not work there (the OAuth client allows
the production origin only); sign in with **"Sign in as Test User"**, the dev test account.
The preview shares the production database.

**Councils is the first integrated domain. Earlier browser coverage ran** on
localhost (2026-09-18) and on the preview's production build with a live service worker
(2026-09-19). Create, rename, add and name sections, conduct, carry a section by the button,
delete (tombstone), an offline edit that survives a reload, two tabs on one field ending in a
conflict with both versions kept, leaving a screen right after an edit or a delete, a legacy
write beside the engine, and every council reader agreeing. Revisions for each case are in the
closing log.

**Closed locally in the 2026-09-19 continuation:**
`BUG-20260913-engine-idle-banner-hides-unfinished-work`,
`BUG-20260919-engine-field-buffer-diverges`, and
`BUG-20260919-engine-conflict-local-failure`. Evidence and limitations are above.
`BUG-20260919-council-outcome-bypasses-manual-scope` is also closed locally with
manual-form conflict, cancel, restart/recovery and screen-wiring evidence above.
Production rollout remains open; legacy council query-cache preservation is covered above.

**Inherited main-branch note (verify before publishing): two commits were NOT pushed** (a push of `main` is a production deploy — the
owner's button): `778b3b02` (a test pinned to 2026-09-18 that turned red on that day and would
block every Vercel build) and `ecec9508` (the dev test account's password shipped in the public
production bundle). Both are already merged into this branch. After they reach production, the
test account's password must be rotated — `BUGS.md` → "Открыто, но не «код-фикс»".

**How a domain is rolled out changed on 2026-09-18** — read "Rollout order" before touching any
switch. Closing a collection to legacy writers is the LAST step, not the first.

**Eleven other domain rows remain incomplete** (sermons already has partial adapters).
See "Whole-app remainder" below; the whole-app objective is not complete.

### Where the next agent continues

Continue autonomously in this order and record evidence, rather than waiting for the
owner's eventual device acceptance before doing independent implementation work:

1. Preserve the verified atomic queue and its mixed-version request isolation.
2. Expose an engine-owned membership scope with pinned opening versions, including
   bulk add, remove and reorder; integrate all series screens/readers/writers and
   retire their separate outbox. Groups cannot activate before this boundary closes.
3. Migrate the remaining domain rows with their behavior, recovery and bypass gates.
   Group CRUD, conduct, creation, readers and legacy preservation are integrated;
   group/series coupling and final acceptance remain open.
4. Re-run production build, rules emulator and installed-PWA checks for the final tree.
5. Physical iPad/phone acceptance, production switches/rules deployment and test-account
   password rotation remain separately tracked external/owner actions. They have not
   been performed by this continuation.

The earlier recommendation to wait for councils to be live before implementing other
domains is superseded by the owner's explicit autonomous whole-app instruction.

## How to run and check this locally

The dev server needs the collection named on both sides; the client variable is
compiled into the build, so it has to be present when the server starts:

```sh
cd frontend
NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS=councils DATA_ENGINE_COLLECTIONS=councils npx next dev -p 3005
```

Port 3005 keeps this out of the way of a dev server already running on 3000. Sign in
on the landing page with "Войти как тестовый пользователь" — an existing dev account,
no account is created. `frontend/.env.local` is gitignored and does not exist in a
fresh worktree; copy it from the main checkout.

**Two traps that cost hours here.** A browser-automation tab reports
`visibilityState: 'hidden'`, and the engine deliberately does not read collections for
a hidden tab — that is its read-budget policy, not a defect — so nothing loads until
visibility is emulated:

```js
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
document.dispatchEvent(new Event('visibilitychange'));
```

And the engine's own state lives in four IndexedDB databases
(`preacher-data-engine-v1`, `-state-v1`, `-snapshots-v1`, `-cursors-v1`). Reading them
answers questions no console message will: what is queued, what is still a draft, what
the cached collection actually holds.

To inspect the server side directly, any page can call the engine's routes with the
signed-in token from `localStorage['firebase:authUser:…'].stsTokenManager.accessToken`:
`/api/data-engine/collections/councils?limit=100`,
`/api/data-engine/documents/councils/<id>`, and `POST /api/data-engine/commands`.

## Where the code lives

- `frontend/app/data-engine/` — the engine itself, written by its author; this
  migration changed `react.client.tsx`, `server.ts`, `protocol.ts`,
  `serverRelations.ts`, `types.ts` and `domainPolicy.ts`.
- `frontend/app/hooks/useCouncilsDataCollection.ts`, `useCouncilDataDocument.ts`,
  `useCouncilsRead.ts` — the councils adapters and the one reader every screen uses.
- `frontend/app/(pages)/(private)/care/council/` — the council screens, plus
  `EngineCouncilCreator.tsx` and `EngineCouncilMigration.tsx`.
- Gates before any commit, from `frontend`: `npm run test:fast`, `npx tsc --noEmit`,
  `npm run lint:full`.

## How this relates to the existing documents

- [`data-engine-proposal-2026-09-12.md`](./data-engine-proposal-2026-09-12.md) — the architecture and why B was chosen. Unchanged.
- [`data-engine-implementation-plan.md`](./data-engine-implementation-plan.md) — the original ten-item delivery plan. Items 1-3 are closed there; this file continues from item 4.
- [`data-engine-remaining-admin-writers.md`](./data-engine-remaining-admin-writers.md) — the staged legacy-writer boundary. Still current.
- [`../audits/2026-09-12-sync-mechanisms-context.md`](../audits/2026-09-12-sync-mechanisms-context.md) — the audit that reproduced five data-loss scenarios.

## Verified state at the time this log was opened (2026-09-12 — a snapshot, not the current state)

Measured at the time, not quoted from the documents above. For where things stand
now, read the first section instead:

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
- Most fields use `LiveTextInput`/`LiveTextArea` autosave. Held-outcome editing does
  have a manual Save form, now integrated through `useDataForm`. The original
  claim that this domain avoided manual forms was incorrect.
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
| 3b | Councils writing, **whole**: create, update, delete and the two-council carry | 3a | Every council write runs through the engine, the carry as a registered core command; the conflict matrix is red before it is green | closed — create, update, delete, carry, replay and recovery proven; the carry button works (it was misread, see Corrections) |
| 4 | Remaining council readers and legacy retirement | 3b | Hub, breadcrumbs, calendar and the pre-database localStorage carry-over; only then is the domain migrated | readers and carry-over done; retiring the legacy hook left |
| 5 | Live browser proof for councils | 4 | Two windows, offline, reload mid-save: both edits survive; a conflict shows both versions | closed — localhost 2026-09-18 and the preview's production build 2026-09-19, both against the dev test account. Not yet on a real iPad or an installed PWA |
| 6 | Core bugs surfaced by 3-5 | 5 | Each fix has a red check: disable the fix and the test fails | the seven filed on 2026-09-12 are closed with red checks (2026-09-18); anything step 5 surfaces still lands here |
| 7 | Receipt amplification | 6 | A thousand saves do not grow storage linearly (`app/data-engine/server.ts`) | closed — was already fixed in `35abc917`: an acknowledged receipt is under 1 KB whatever the document size (`__tests__/data-engine/server.test.ts`, "stores a compact ACK…"). Receipts still grow by COUNT, one small document per save; retention of old receipts is not designed yet |
| 8 | Legacy queued council writes | 4 | A pending legacy write is discovered, shown and either replayed or exported | open |
| 9 | Rollout, in the order under "Rollout order" | 7, 8 | An old PWA keeps working on documents the engine has not touched, is refused with its text kept on the ones it has, and the collection is closed last; owner presses every button | mechanisms built and tested 2026-09-18; nothing deployed |

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
| ~~Receipt amplification, four more core P1 defects, two core P2 defects~~ | — | **Not blockers: fixed in `35abc917`, confirmed by mutation on 2026-09-18.** These three rows were written from the tracker, not from the code — see "Corrections to earlier records" |
| ~~A refusal that old bundles misread~~ | `app/data-engine/legacyBoundary.server.ts` | Fixed 2026-09-18: the refusal speaks 426, and the new bundle knows it by its code at any status |
| ~~Mixed-mode collection reads~~ | `app/data-engine/activation.ts`, `collections.ts` | Fixed 2026-09-18: while legacy writers share a served collection the server says `legacyOpen` and the reader lists the whole collection on every synchronisation; closing the collection is a separate, last switch. **Cost to revisit:** one full listing per synchronisation while mixed — fine for councils, not for sermons |
| Manual Save forms | `app/data-engine/README.md`, manual scopes | The mechanism exists and is wired for the sermon title and verse (`useDataForm`, `manualScope.ts`; the open-A / type-B / remote-C case is guarded by `manualScope.test.ts`). What is owed is a live pass per form as each domain migrates — not a design |
| Rules not deployed | `frontend/firestore.rules` | Prepared rules exist but are not live; until they are, an old client can still write a migrated document offline, the engine's SDK listener is denied the change head (it falls back to HTTP polling, up to ~15 s late), and a tombstone is unreadable to its owner's listener. `npm run test:rules` proves them on the emulator (256 + 5 checks) and is NOT part of the build gate — run it before deploying rules |
| Legacy queued writes | `legacyRecovery.client.ts`, `legacyQueryRecovery.client.ts` | Council query-cache copies are now archived before hydration and offered for preview/export; no reliable baseline exists for automatic import. Outbox/membership/paused-mutation migration remains domain-specific work for the other domains. Old input already reverted or never persisted cannot be reconstructed |
| Device validation | — | Proven on a production build with a live service worker (preview, desktop Chrome, 2026-09-19). Not yet on an iPad, a phone, or an installed PWA. The current continuation verified genuinely visible Chrome tabs on localhost; no visibility emulation was used |
| Cloud cost verification | `data-engine-operations.md` | Protocol operation counts and mixed-mode scenarios are now tested; actual project usage, retry/index/listener overhead and physical-device session costs remain unmeasured |

### Domains

"Ops" counts exported functions in the domain's legacy write service — the surface
that has to move. "State" is what exists today, measured by imports, not by intent.

| Domain | Ops | State today | What it still needs |
|---|---|---|---|
| Councils | 6 | Create/read/update/delete, carry, readers and held-outcome manual forms integrated behind the collection switch; current browser and regression evidence above | Live cloud cost verification, recovery lifecycle and rollout/device gates |
| Sermons | 33 | Partially on the engine: core fields and scratch wired; `useSermonThoughtsDataDocument` written but **imported by no screen**; eight controls inert behind the switch (`page.tsx`, `legacyReadOnly`) | Wire thoughts; adapters for outline, structure, plan, preach dates and the AI writers; un-inert the eight controls. Largest domain, last in order |
| Groups | 11 | CRUD, conduct, creation, readers and legacy-copy preservation integrated; real engine regressions and dev-browser evidence recorded below | Series boundary must migrate before activation; final PWA/device and rollout acceptance |
| Studies (notes + materials + share links) | 7 | Untouched; the note editor is the most complete legacy example of the contract | Full adapter; `material-notes` relation already exists in the core; share links need an ownership decision |
| Series (+ membership) | 6 + 6 | Server relation, atomic ownership and public pinned membership stage implemented with crash/restart evidence; feature screens still legacy | Whole-action delivery/conflict controls, full reader/editor migration, outbox retirement and browser acceptance |
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

## Rollout order

**Revised 2026-09-19 after checking the actual rules.** Separate document protection
from collection closure. `legacyExisting()` rejects writes to marked documents;
`closedToBrowserWrites()` defaults to an empty list and leaves unmarked legacy
councils writable. Therefore protective rules can and must be deployed **before**
any engine write, without prematurely closing the whole collection. The inherited
order (engine writes first, rules later) allowed an old SDK write to erase a marker.
The emulator's full-set/marked-document negative checks establish this boundary.

The client switch is compiled into the bundle; changing it requires a build and a
service-worker update/reload. The server can serve both protocols while unmarked
legacy documents still exist. Mixed readers use complete collection listings
(`legacyOpen`) because old writes do not produce engine feed entries; this has a
cost that must be measured before larger domains are enabled.

| Step | Action | Guarantee and rollback limit |
|---|---|---|
| 0 | Merge the verified code with engine switches off; keep the collection closure list empty | Normal legacy paths remain selected. Revert the merge before activation if needed |
| 1 | Run rules tests and deploy the prepared protective rules, still with an empty closure list | Unmarked legacy writes still work; marked documents cannot be overwritten or stripped of metadata. Engine heads/tombstones become readable. Verify the deployed rules release before the first engine command |
| 2 | Complete test-account/device acceptance and legacy-copy preservation checks; then build/deploy with both councils serving/client switches enabled | New bundles preserve the previous persisted council cache before hydration/expiry, then use the engine. Archived copies are preview/export evidence, never automatically imported into a fresh baseline. Old bundles can still edit unmarked documents; an engine-touched document refuses legacy writes |
| 3 | Verify every active device has reloaded into the new bundle before it edits migrated documents | Installed PWAs do not update synchronously. The app version must be checked on each device; a server environment change is not proof |
| 4 | Set server `DATA_ENGINE_CLOSED_COLLECTIONS=councils` and rules `closedToBrowserWrites` to include councils, then deploy both | The whole collection is closed to legacy writes and readers may use only the feed. Roll back closure by reverting both settings, retaining protective rules |

**Cascades cross activation boundaries.** `processCommand` validates every planned
write against served collections before persisting any document or feed. The route's
primary-collection check alone is insufficient. A disabled related collection refuses
the entire action with `related-collection-not-enabled`; the original local request
is retained. Already accepted receipts replay their proof, never re-plan the effect.
Enabling a collection later does not mutate a previously refused receipt.

Known write dependencies from `serverRelations.ts` (read-only references do not
require activation):

| Operation | Other collections it can write | Rollout consequence |
|---|---|---|
| Delete group or sermon | series | Finish series compatibility before unrestricted deletion |
| Delete series with legacy backlinks | sermons, groups | Do not assume groups+series alone is a complete activation cohort |
| Delete tag | sermons | Finish sermon compatibility before custom-tag cascades |
| Material membership/create/delete | studyNotes | Notes/materials need compatible writers together |
| Delete study note | studyMaterials, studyNoteShareLinks | Include relation and share-link ownership in study migration |

The server switch proves that a protocol is served; it does not prove the feature
UI is migrated or that every installed PWA reloaded. Those are separate rollout
gates. The write-set check prevents accidental effects in unserved domains while
compatible client rollout is completed.

**After the first engine write, disabling the client switch is not a safe rollback.**
Marked documents are intentionally unwritable by legacy paths. Use a forward fix
or an explicitly reviewed data migration; do not strip markers or weaken rules to
make an old client appear functional.

**Preview shares the production database.** Scope switches to Preview for this
branch, use only the authorized test account and owned QA fixtures, and keep the
protective-rules requirement visible. This continuation has not deployed rules or
changed Production switches; local checks do not establish the current cloud state.

**Old bundles impose a real residual risk.** An already shipped client may keep an
unsent change only in its persisted query cache; the new migration gate preserves
what is present on first startup, even if expired. It cannot reconstruct text the
old SDK already reverted, data never persisted, or cache overwritten by another
old tab after that snapshot. Reload devices before further migrated-domain edits.
A missing cache copy is not proof there was no unsaved work. No automatic merge is
safe without its original baseline. The new UI offers archived copies for manual
inspection/export and keeps them until a separate reviewed retention policy exists.

## Testing on a Vercel preview — what the owner does, and what not to touch

A preview deployment of this branch is the only way to try the engine on a real iPad and an
installed PWA. It is a different address and the SAME production database.

1. Push the branch. Vercel builds a preview for it (it did for `sermon-design-by-church` on
   2026-09-12); the build runs the test suite, which is green with the switches set.
2. In Vercel → Settings → Environment Variables add, scoped to **Preview** and to the branch
   `data-engine` only — never to Production: `NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS=councils` and
   `DATA_ENGINE_COLLECTIONS=councils`. Redeploy the preview: the first of the two is compiled into
   the bundle. Do NOT set `DATA_ENGINE_CLOSED_COLLECTIONS`.
3. Open the preview address and sign in with **"Sign in as Test User"** (Google sign-in is not
   allowed on this origin). Work ONLY on councils created there for the test; the test account's
   own "QA совет с секциями" is left alone. Reading real councils is harmless — only a write marks
   a document. A council the engine
   has written is refused by this branch's legacy road, but **production still runs `main`, which
   has no such guard yet**: opening a test council in the production app and editing it there
   would overwrite it, marker included. Leave test councils to the preview.
4. When done, delete the test councils on the preview. A deleted one leaves a tombstone that the
   production list does not show — except four tombstones written on 2026-09-13 in the old shape
   (with `userId`): until this branch reaches production, the production app shows them to the
   test account as blank councils. Test account only; harmless; do not "fix" them by hand.
5. Expect other devices' changes to arrive within about fifteen seconds rather than at once: the
   production rules do not yet let the engine's listener read its change head, so it polls.

What to try on the device: create and type, close the app mid-typing and reopen, airplane mode
while typing then back, the same council open on two devices, carry a section, delete.

**Before checking a new build in a tab that already had the preview open**, remove its service
worker and caches for that origin only (never clear localStorage or IndexedDB — the session and the
engine's state live there), then reload:

```js
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
```

A marker that the new client code is loaded: search the loaded chunks
(`performance.getEntriesByType('resource')`) for a string of the change, e.g. `leavingIntent`.

## Corrections to earlier records

Added 2026-09-18 by the third agent on this branch (the engine core was written by one
agent on 2026-09-12, the councils domain by a second on 2026-09-12/13). Each correction
names the record that was wrong, why, and the evidence — so the next reader can check
the correction instead of trusting it.

### 1. "Seven core defects are untouched and block deployment" — they were already fixed

**What was recorded.** `BUGS.md` carried seven engine entries dated 2026-09-12, and this
log's summary and blockers table repeated them as open, with receipt amplification named
as the thing that blocks any deployment.

**What is true.** All seven were fixed inside the engine's first commit, `35abc917`, by
the same author who filed them — the entries were written during that work and never
removed (the repository rule is "fixed → delete the entry"). The summary here was then
written from the tracker rather than from the code.

**Evidence.** For each fix, one mutation that switches it off; the named test passes with
the fix and fails without it, for the reason the tracker entry described. Run in a
detached copy of the branch on 2026-09-18:

| Tracker entry | Fix switched off | Test that turns red |
|---|---|---|
| `engine-receipt-amplification` | `server.ts` `serializeReceipt` stores the full result instead of the compact acknowledgement | `__tests__/data-engine/server.test.ts` "stores a compact ACK whose size is independent of unchanged large document content" |
| `engine-ack-metadata-conflict` | `protocol.ts` `mergeDocumentFields` stops excluding the server-owned `rev` | `app/data-engine/__tests__/commits.test.ts` "delivers saved A then B after a full engine restart…" — fails with the very `rev.core` 1/2/3 conflict the entry named |
| `engine-successor-save` (captures later typing) | `controller.ts` `save` takes its value inside the queue instead of at invocation | `commits.test.ts` "freezes save at invocation before persistence…" |
| `engine-successor-save` (needs an open editor) | `engine.ts` `retry` no longer drains the commit queue | `commits.test.ts` "delivers saved A then B after a full engine restart without opening an editor…" |
| `engine-manual-form-baseline` | `manualScope.ts` `save` reads the confirmed copy at Save time instead of the one pinned at open | `app/data-engine/__tests__/manualScope.test.ts` "pins pristine A at open…" — without the fix the server answers `acknowledged` where `conflict` is required |
| `engine-local-retry` (checkpoint) | `controller.ts` `retryPersistence` skips the checkpoint write | `app/data-engine/__tests__/controller.test.ts` "retries a failed local checkpoint with the latest draft…" |
| `engine-local-retry` (journal) | `retryPersistence` skips resubmitting the prepared command | `controller.test.ts` "retries a missing journal commit with the identical prepared command…" |
| `engine-collection-demand` | `collections.ts` `assertCurrent` ignores "no listeners left" on network steps | `app/data-engine/__tests__/collections.test.ts` "stops background hydration requests after the final watch is released" |
| `engine-collection-cache-race` | `collections.ts` `reconcileAbsence` walks the current cache instead of the rows captured before the read | `collections.test.ts` "does not call a newly committed cache insertion a missing deletion tombstone" — fails with "A versioned document is missing its deletion tombstone" |

**What this does not prove.** A test guards the scenario it encodes. None of these seven
has been exercised in a browser, and receipts still grow by COUNT (one small document per
acknowledged save): no retention for old receipts or change-feed pointers exists yet.

### 2. "The carry button sees no targets" — the measurement said the opposite

**What was recorded.** `BUG-20260913-engine-carry-button-sees-no-targets` (P1): with two
councils being prepared, the button reported `aria-expanded="false"`, read as "the screen
believes there are fewer than two destinations"; after one press both documents were
unchanged.

**What is true.** `care/council/[id]/page.tsx` renders
`aria-expanded={carryTargets.length > 1 ? choosingTarget : undefined}`. With fewer than two
targets the attribute is ABSENT; `"false"` appears only when there are two or more and the
chooser is closed. One press opens the chooser; the carry is the second press. "Nothing
changed after the press" is what that design does, not a failure of it.

**Evidence.** `care/council/__tests__/EngineCouncilCarry.test.tsx` pins the three shapes
(two targets → chooser → carry with the chosen id; one target → one press; none → the
person is told) plus a refusal being spoken aloud. Two mutations turn it red: ignoring the
chosen target, and never opening the chooser.

**Settled in a browser the same day.** Two councils being prepared, the source conducted to
`held`: the button read `aria-expanded="false"`, exactly as the report measured; the first press
opened "Куда перенести?" and changed nothing (source revision 7, destination 1); choosing the
destination moved the source to revision 9 with the "carried to" mark and the destination to
revision 2 with the section in it. The entry is removed from `BUGS.md`.

### 3. Found while checking the above: a refusal that destroys text on old bundles

Not a correction of a record but of an assumption — that refusing a legacy write is safe.
`legacyBoundaryResponse` answers **409**. In the bundle already shipped to users, the
councils client treats 409 as a compare-and-set conflict whose body is the current council
(`services/councilsTransport.client.ts`: `conflict: status === 409, current: value`), and
`hooks/useCouncils.ts` then forgets the waiting text and stores the body in its cache.
`services/serviceOrderEditing.client.ts` reads 409 the same way. This branch's own client
tells the two apart by the body's `code`, but a shipped bundle cannot be changed, and an
installed PWA left open keeps running one for days (`AppUpdateButton.tsx`: the update is
voluntary). Filed as `BUG-20260918-legacy-refusal-409-reads-as-conflict`; any status
outside that client's table lands in its `refused` branch, which keeps the text.

### 4. My own plan was wrong about the order of a rollout

Recorded because it was the author of these corrections who got it wrong. The first design of
2026-09-18 closed the collection to legacy writers at the moment the engine began to serve it
("one source of truth: the same env list"). The adversarial review pointed at
`react.client.tsx` — the client switch is `process.env.NEXT_PUBLIC_*` inside a client module,
inlined at build time — and the conclusion follows without any experiment: the two switches
cannot change together, the server one is instant, and closing first is a write outage for every
bundle already running. The design became two switches with a mixed stage between them (see
"Rollout order"). The lesson for the next domain: ask of every switch WHEN it actually takes
effect on a device that is already running, before ordering a rollout around it.

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

### 2026-09-13 — Councils from before the database now travel through the engine

The legacy hook carries councils that lived in `localStorage` before the section had
a database. Left alone, it would have created them on its own road — planting
unmarked documents inside a domain the engine already owns, which is precisely the
mixed state that makes a list show what the database no longer has.

`EngineCouncilMigration` does it instead while councils are migrated: it carries one
council at a time through the ordinary create path, so each arrives with the protocol
marker. It only carries what the server itself has not answered with, and the browser
copy — the only copy these councils have — is cleared solely after every one of them
has landed. A refusal stops the queue and leaves everything in place for the next
opening. The legacy carry-over now stands down whenever the collection is on the
engine.

Three tests, including the refusal case. A mutation that removes the stop did **not**
turn the tests red, and the honest reading is that it changes no behaviour: a refused
council never advances the queue, so the end — and the clearing — is never reached.
The guard is duplicated rather than load-bearing, and this is recorded rather than
claimed as proof.

Gates: `test:fast` 6649 passed / 6654, `tsc --noEmit` exit 0, `lint:full` exit 0.

### 2026-09-13 — The carry button does not reach the mechanism

Walked the whole path through the interface this time: two councils created through
the screen, a section added and named, the source conducted to `held`, then the
"В следующий совет" button pressed.

**It neither carries nor offers a choice.** With two councils in `preparing` on the
server, the button reports `aria-expanded="false"` — the screen believes there are
fewer than two destinations — and after the press both documents are untouched
(source stays at revision 4, destination at 1, no mark). Warming the list first by
entering through the council list, so the navigation happens inside the application,
changes nothing.

Filed as `BUG-20260913-engine-carry-button-sees-no-targets` (P1) with the measurement
and the anchors. The cause is localised to how the screen obtains its list of
destinations, not to the mechanism: the same operation sent directly changes both
documents in one transaction and a replay adds nothing, both proven earlier today.

Retiring `useCouncils` is **not** available as a next step: three screens and
`useCouncilsRead` call it as the legacy half of the per-collection switch, and that
half has to keep working until the rollout.

Test data created for this pass was deleted afterwards; only the account's own
council remains.

### 2026-09-18 — The branch is brought onto current main and made to tell the truth

**Merged `main`** (26 commits since `4c6360ab`), five conflicts, each resolved by keeping
what both sides meant; the merge commit lists them. The architecture ledger moved with it:
`main` had removed the settings page's SDK imports (two entries deleted) and added
`waitForPendingWrites` to `useDocumentFreshness` (recorded as discovered debt, count one) —
see `frontend/__tests__/architecture/README.md`.

**A date bomb in the council list test** went off on this very day: the seeded council is
dated 2026-09-18, the page counts days from the real clock, and the test never froze
"today". It was red on `main` as well, where Vercel gates every build on it. The clock is
now pinned at noon UTC (not midnight: `daysUntil` reads the local calendar date) and the
test is green in three time zones.

**The tracker and this log were corrected** — see "Corrections to earlier records": seven
entries removed after a red check each, the carry-button entry refiled under "needs
re-checking" with a new test, the idle-banner entry moved to the P2 section its own text
names, and one new P1 filed for the 409 refusal that old bundles read as a conflict.

**Independent review.** The rollout design was handed to a second engine for an
adversarial pass; Codex was over its usage limit until 2026-09-19 01:10, so a clean
subagent on a different model ran instead — the same provider, so its agreement is not
counted as independent. **The owner declined the Codex pass on 2026-09-18**, so the review on
record is that same-provider one: nine of its twenty-two findings were confirmed in code and
acted on, two were refuted (the log names both). Nobody outside this provider has tried to break
the rollout design.

Gates on the merged tree, from `frontend`: `tsc --noEmit` exit 0; `test:fast` with the date
bomb fixed and the carry test added — recorded in the commit that closes this entry.

**Unproven.** Everything a browser has to show: the carry button end to end, two windows,
offline, reload mid-save. No rules, flags or production data were touched.

### 2026-09-18 — The mixed stage of a rollout is made safe; the closure becomes the last switch

Six changes, each with a test that was red before its code and a mutation that turns it red
again (eleven mutations, run in a detached copy of the branch):

1. **The enabling deploy could not have built.** The Vercel build runs the suite with the
   production env; with the engine switches set, four tests asserting "off unless opted in"
   went red. `jest.setup.js` now clears `NEXT_PUBLIC_DATA_ENGINE_*` and `DATA_ENGINE_*` as it
   already did for the client-SDK flags; `buildEnvIsolation.test.ts` is the alarm. Full suite
   green with the switches set: 6934 passed.
2. **A deleted council haunted every legacy reader.** The tombstone carried `userId`, and every
   legacy reader asks `where(userId == uid)` — including the SDK query inside shipped bundles,
   which cannot be taught to skip it. A tombstone now names its owner in `_dataEngineOwner`
   and matches no legacy query; the engine lists it through a second owner query merged in
   document order; rules let its owner read it. One predicate (`utils/engineTombstone.ts`)
   covers tombstones written before today in the three legacy council lists.
3. **The refusal spoke a status old bundles read as a conflict.** 426 instead of 409; the new
   bundle knows the refusal by its code at any status.
4. **One refused carry wedged a council's saves for good.** A coded failure of the domain policy
   is now a terminal `refused` on the request; a carry is committed at once as its own request.
5. **Legacy writers were invisible to engine lists.** `activation.ts`, `legacyOpen`, a full
   listing per synchronisation while mixed, and the collection closure as a separate last switch
   on the server and in the rules.
6. **Readers and the pre-database carry-over.** The dashboard had arrived from `main` still on
   the legacy hook; `councilReaders.test.ts` now fails the build for the next one. The legacy
   list query stands down beside the engine. The carry-over hands over only council fields,
   waits for a server answer of this session, never resurrects a tombstoned id, and says so
   when it stops. The "new council" chip is not offered where it could only fail.

**Refuted, and therefore not changed:** the review's claim that the carry button can target its
own council — the button exists only on a HELD council, and a held council is never among the
ones being prepared.

Gates from `frontend`: `test:fast` 6934 passed / 6939 (5 skipped, opt-in emulator suites), the
same with the engine switches set, `tsc --noEmit` exit 0, `npm run test:rules` 256 + 5 passed on
the emulator; `lint:full` in the commit that closes this entry.

**Unproven.** Nothing here has been walked in a browser yet: the carry button end to end, two
windows, offline, reload mid-save, and an old bundle meeting a marked council. No switch, rule
or production document was touched. The review used so far ran on the same provider and is not
counted as independent; the owner declined a pass by a second engine (Codex) on 2026-09-18.

**Open design questions, not blockers for a councils pilot:** retention of receipts and
change-feed pointers (one small document each per save, never deleted); the cost of the mixed
stage for a large collection; a second road for the engine's list when its HTTP route is down
and the local cache is empty (the legacy list had the SDK replica); recovering what an old
bundle left in the persisted React Query cache.

### 2026-09-18 — Councils walked in a browser: the whole cycle, offline, a reload, two tabs, the legacy road beside the engine

Dev server of this branch on port 3005 with councils enabled on both sides, signed in as the dev
test user, document visibility emulated (an automation tab is always `hidden`). Every number
below was read from the running server through `/api/data-engine/documents/councils/<id>`.

| Case | What was done | What the server and the screen showed |
|---|---|---|
| Create, edit | "FABLE source" created from the list screen; two sections typed from the keyboard | revision 1, then 5 with both sections; banner "Сохранено." |
| Conduct | one section marked postponed, the council finished | `status: held`, revision 7 |
| Carry by the button | first press, then the destination chosen in "Куда перенести?" | press one: chooser open, nothing written; press two: source 7 → 9 with the mark, destination 1 → 2 with the section; the "new council" chip is not offered |
| Offline edit | `navigator.onLine` false + `offline` event, title typed | screen keeps the text, banner "Изменения в очереди. Сервер ещё не подтвердил…", server unchanged at revision 2 |
| Reload with the edit unsent | page reloaded | the durable request left by itself: revision 3 with the offline text, banner "Сохранено." |
| Two tabs, same field | tab 2 offline types "…B", tab 1 online types "…A" | tab 1 delivered tab 2's request (requests are owner-scoped on disk: any live tab sends them) — server "…B", revision 4; tab 1's own "…A" met a real conflict: red banner, both versions kept, "Оставить мой текст" → revision 5 with "…A"; tab 2 showed "…A" as soon as the caret left its field (`LiveTextInput` owns its text while focused) |
| Legacy write to a marked council | `PUT /api/councils/<id>` with the user's token | 426 `data-engine-required`; document untouched at revision 5 |
| Legacy create and delete beside the engine | `POST /api/councils`, later `DELETE` | the unmarked council appeared in the engine's list on the next opening; after the legacy delete the hub count dropped and the row was gone — the scenario of `BUG-20260912-engine-collection-shows-deleted-legacy`, closed live |
| Delete through the engine, another tab open on it | the council deleted from tab 1 | tombstone at revision 6; legacy `GET /api/councils` returns no ghost; tab 2 says "Удалено на сервере…" and "Такого совета нет" |

Dev-server log: no error lines. Test data removed; the account's own "QA совет с секциями" was not
touched. Six tombstones remain in the test account (four from 2026-09-13 in the old shape, two
from today in the new one).

**Seen and not changed.** A title field that still has the caret keeps showing its own text while
the engine has already adopted a newer remote one; one more keystroke there would send the
field's whole text over the remote change. That is `LiveTextInput`'s rule, the same on the legacy
road — recorded, not judged a defect of the engine.

**Still unproven.** A genuinely foregrounded window, an installed PWA, a phone or iPad, a preview
deployment, and the read and write cost per session. No engine outside this provider has reviewed
the design (declined by the owner).

### 2026-09-18 — The branch is on GitHub and the preview has its two switches

On the owner's word: the date-bomb fix was committed to `main` (`778b3b02`, not pushed — a push
of `main` is a production deploy and was not asked for); `data-engine` was pushed with an
upstream; and `NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS=councils` and `DATA_ENGINE_COLLECTIONS=councils`
were added through the Vercel CLI, scoped to **Preview · branch `data-engine`** only
(`vercel env ls` shows exactly that scope). Nothing was added to Production and
`DATA_ENGINE_CLOSED_COLLECTIONS` does not exist anywhere. The first preview build started before
the variables existed and therefore has the engine off; the build triggered by this commit is
the first one that carries them.

Owed by the owner: acceptance on a real device through the preview, on councils created for the
test (see "Testing on a Vercel preview").

### 2026-09-19 — The preview found what localhost could not: leaving a screen stranded the last edit

The owner could not sign in on the preview (Google's OAuth client allows the production origin
only). The chosen way in was the dev test account, which also exposed a production leak: its
e-mail and password shipped in the public landing bundle (`BUG-20260919-test-account-password-in-production-bundle`,
fixed on `main` in `ecec9508` and merged here). The test login now exists only in builds that
decide so at build time; `NEXT_PUBLIC_ENABLE_TEST_LOGIN=true` is set for Preview · this branch.

Walked on the preview (a production build with its service worker active), revisions read from
the server: create and edit (1 → 5), conduct (7), carry by the button (source 7 → 9 with the mark,
destination 1 → 2), an offline edit that left by itself after a reload (2 → 3), and two tabs on one
field ending in a real conflict with both versions kept (4 → 5). Per-collection switching held:
the engine route answered 200 for councils and 503 for sermons.

**Then a defect that the slower dev server had hidden.** Deleting a council sent the person to the
list while the council stayed alive on the server (revision 5); opening it again in the same tab
delivered the deletion then (revision 6) — a deletion that happens later, by surprise. Typing into
a title and leaving within the 750 ms autosave delay left the server on the old title. Cause:
`react.client.tsx` disposed the editor on unmount without a last save, and the autosave timer was
simply cleared; the intent sat in a checkpoint no editor would read again. The legacy councils hook
had "the last save on the way out"; the engine did not — a regression, not a new risk.

Fix (`BUG-20260919-engine-leaving-strands-last-edit`):
- `ManagedEditor.close({ flush })` — closes the entry at once (the same editor identity may reopen
  immediately) and hands a savable draft to the engine's commit queue as a durable request, which
  any editor or tab of the owner delivers, now or after a reload. Drafts that wait for the person
  (conflict, refusal, deleted elsewhere) are left alone; `flush` is false for manual forms and
  creation.
- The React layer closes with `flush` equal to the document's autosave setting, and saves at once
  when the page is hidden or left (`pagehide`, `visibilitychange`) instead of waiting out the delay —
  on an iPad that is the home gesture or switching apps.

Tests red before the fix: three in `commits.test.ts` against a real engine (a typed draft, a
deletion, nothing sent when not asked), three in `react.client.test.tsx`. Four React tests that
pinned the old "unmount disposes" contract were rewritten to the new one. Mutations: removing the
flush, the hidden-page save, or `close` itself turns their tests red. Gates: test:fast 6945 passed /
6950 with the preview's switches set, tsc 0, lint:full 0 errors.

**Known, not changed:** a checkpoint left by an earlier page load still lists a request that has
since been delivered, so "Найти сохранённые черновики" can offer work that is already saved
(neighbour of `BUG-20260913-engine-idle-banner-hides-unfinished-work`).

**Re-walked on the preview after the fix** (`733cdbc`; the tab's service worker and caches for
the preview origin were removed first and the new engine chunk confirmed loaded): a title typed
and left at once reached the server (revision 1 → 2, the list shows it); a council deleted with an
immediate return to the list was a tombstone at once (revision 3) and left the list. The last test
council was deleted the same way (revision 10). The engine list, `GET /api/councils`,
`/api/owner-list` and the screen all agree on the account's one remaining council; no console
errors. Queue item 5 now holds for a production build with a live service worker, not only for
localhost. Still not walked: a real iPad, an installed PWA.


## Group migration continuation — 2026-09-19

This is an open implementation phase; the groups switch must stay off until the
whole domain passes. The existing `useGroupDetail` page holds a second content
buffer, a 500 ms timer, revision bookkeeping and its own freshness banner.
`ConductPreflight` holds edited durations until Start. Both need the engine to own
the ancestor at opening, not a fresh baseline constructed when Save is pressed.

Migration map:

| Surface | Required seam / invariant |
|---|---|
| Group shaping | One pure hydrator shared with the existing SDK service; no Firebase import in a domain editor |
| Group detail and embedded templates/flow/meetings | One `DataDocumentProvider`, immediate draft updates; no screen-local delivery timer or revision counter |
| Conduct setup | Explicit `useDataForm` for durations; durable unsent work and pinned opening values; timers remain transient UI state |
| List/create/delete, dashboard and breadcrumbs | Shared collection read and durable creation/deletion; never claim queue acceptance is a server save |
| Calendar and series readers | Same collection/document view as group detail; no second cache claiming freshness |
| Series membership and group deletion | Existing `series-membership` command and `serverRelations.detachSeriesMember`; deletion already cascades atomically inside the engine, so do not add a screen-side sweep |
| Legacy migration | Preserve groups list/detail/calendar copies plus paused mutation/outbox payloads before hydration; previews are not automatic imports |
| Boundary checks | Add migrated imports/callers to enforcement only after the whole group route is wired; do not grow the legacy exception ledger |

The prior list-hang tracker entry is already locally repaired by the inherited
`readOwnerList` / `readOwnerDocument` paths. The remaining iPad acceptance is not a
reason to reimplement that reader. Group meeting-date writes still use the old
full-array update; their replacement must prove concurrent additions/edits/deletes
using the actual shared protocol, not only a mocked hook.


Group implementation checkpoint in progress:
- `useGroupDataDocument` delegates fields and ID-based meeting operations to the
  shared editor; the legacy SDK and engine use the same extracted group hydrator.
- Detail uses one presentation with two adapters. The engine adapter has no second
  content buffer, save timer, revision counter or freshness observer. Text controls
  use the shared buffer; meeting metadata is editable after choosing a date, so an
  incomplete meeting cannot poison autosave. Clearing the first date removes that
  meeting and preserves any additional meetings.
- Conduct setup uses the shared pinned manual form. Typing does not send; Start
  explicitly submits. Starting unchanged sends nothing. Restart offers recovery.
- Actual React + DataEngine + runtime + storage-harness tests cover immediate
  offline navigation/reconnect, clean remote text while focused, competing local
  text/conflict/accept-remote, duration conflict and restart recovery. The server
  transport in these tests is replaced by the actual command protocol; these are
  not browser/device proof. Detail/conduct suites currently pass 21 tests.
- Still open: creation, list/read projections, legacy draft/queue preservation,
  series membership compatibility, boundary proof and live browser acceptance.
  Groups remain off. Deleting a group cascades into series and can mark their
  documents, so groups cannot be rolled out beside incompatible series writers.

2026-09-19 group continuation (not yet a rollout):
- Creation immediately checkpoints typed fields, submits only on Create, and
  offers unfinished creations from the list after restart. Delete confirmation
  uses the same document editor. Dashboard, breadcrumbs, calendar and series
  group projections read the shared collection; legacy group queries are disabled.
- Every old group service write refuses with `data-engine-required` before either
  transport. The old outbox holds enabled collections without sending. That refusal
  is terminal for React Query, not a five-attempt transient retry.
- Migration archives group list/detail/calendar copies and complete paused/error
  mutation records before hydration/expiry. Old ID-only mutations are attributed
  only from a unique cached owner. Unattributable bytes remain quarantined under
  an empty owner and are never shown to the next signed-in user. No automatic
  baseline reconstruction or import. Existing localStorage recovery remains visible.
- Live Chrome localhost: own group `54f7a34d-5fc5-4e95-8dde-84c1e4331847`:
  creation draft closed/reloaded/recovered, explicit Create, immediate title edit
  and navigation, then new tab saw `QA engine group last keystroke` and saved
  status. Conduct's unsent 7-minute duration survived leaving and explicit recovery.
  This is development-browser evidence, not installed PWA/device proof.
- Sequential review found list read errors hid creation/recovery. The list now
  shows the error alongside local actions without claiming that an unknown list
  is empty. Regression was red before the fix. A separate suspected Start/input
  race was disproved by the real runtime test; no speculative fix was made.
- Remaining activation blocker: migrate series membership and writers as one
  compatible boundary before switching groups on (delete can mark linked series).
  Architecture ledger did not grow. Public `clientPolicy` contains flags/refusal
  only, no transport or storage access.

2026-09-19 shared submitted-work continuation (in progress):
- Server relation planning now rejects assigning one typed member to two series,
  including creation and stale ancestor item-ID replacement. The bounded owner
  scan accounts for already-read rows before declaring its result complete.
  A real Firestore emulator concurrent assignment test produced one ACK and one
  refusal. The opt-in environment flag previously got erased by Jest setup;
  it is now preserved and all five emulator cases actually execute.
- New editors continue a single durable submitted chain across navigation and
  restart. Unsubmitted later typing stays in its source recovery fork; competing
  branches are not silently combined. Confirmed cache remains separate.
- Collection presentation now projects submitted work with pending/attention
  status, including a queued creation and an addressable pending deletion. ACKs
  bridge feed lag through the canonical snapshot freshness rule. This part is
  undergoing integration, architecture and UI checks; it is not a rollout.
- Next: finish shared handoff/projection review and gates, then migrate series
  membership and all related writers before enabling groups.

- Shared handoff checkpoint verification: test:fast 710 suites / 7,049 tests passed;
  lint has zero errors and 15 inherited warnings; both TypeScript checks pass.
  Sequential review caught and fixed logout clearing and acknowledged-ancestor
  projection, using the existing DataSession merge rule. Browser Chrome localhost:
  edited the own QA group's title to `QA engine submitted handoff`, immediately
  returned to the list, and saw the new title. Offline/restart behavior is proved
  by the actual engine/storage test harness, not claimed as a physical-device run.

- Full coverage passed: 710 suites / 7,049 tests, 92.05% lines (6 tests skipped,
  including the explicit emulator opt-in). Focused submitted-chain coverage is
  100% lines/branches; collection projection is 100% lines. Reports:
  `/tmp/data-engine-handoff-{full-tests,coverage,lint}.log` and
  `/tmp/data-engine-handoff-focused-coverage-2.log`. The five real emulator cases
  were run separately (`/tmp/data-engine-membership-emulator.log`).
- Closed locally in this checkpoint: `BUG-20260919-engine-navigation-hides-queued-work`,
  `BUG-20260919-engine-series-double-assignment`,
  `BUG-20260919-engine-emulator-optin-cleared`. Physical-device and production PWA
  verification of this checkpoint remain open. No cloud switch/rules/deploy changed.

2026-09-19 atomic acknowledgement foundation:
- ACKs include current related snapshots; HTTP validation checks a one-to-one match
  with effect proofs, operation identity, generation/revision, deletion and owner.
  Compact history retains metadata only. Replay adds one read per participant;
  oversized current copies are omitted while compact proof remains available.
- Review reproduced `BUG-20260919-engine-relation-noop-invalid-receipt`. A new
  already-satisfied relation reused an earlier operation marker and could not
  replay its receipt. The planner now records its own primary proof once; repeated
  delivery of that identity writes nothing. The old no-advance unit expectation
  contradicted the end-to-end receipt contract and was corrected.
- Gates: 710 suites / 7,060 tests pass; six real emulator scenarios pass (including
  the no-op and secondary lost-ACK replay); lint/types pass with 15 inherited
  warnings. Focused coverage is recorded in `/tmp/data-engine-atomic-final-coverage.log`;
  full logs are `/tmp/data-engine-atomic-final-{tests,lint,emulator}.log`.
- Review lanes: receipt identity/replay, owner fencing, proof completeness, payload
  bounds, unchanged compact history and actual emulator behavior. No independent
  agent was used. Client multi-document ownership is still pending; this server
  foundation does not complete series migration or authorize production activation.

2026-09-19 atomic local storage checkpoint:
- Production IndexedDB supports participant create/CAS batches in one transaction.
  Ordinary single-document saves delegate to the same implementation. A failed
  participant rolls back every row; racing tabs have one winner; completion waits
  for the transaction commit. Inputs and results are detached copies.
- Gates: 710 suites / 7,064 tests pass; lint/types pass. Focused storage coverage:
  100% lines, 83.78% branches. Logs: `/tmp/data-engine-atomic-storage-{full-tests,lint,coverage}.log`.
  These transaction tests use the storage harness; they are not live IndexedDB
  browser proof. Sequential review checked identity, immutable capture, reference
  retention and transaction ordering.
- Remaining: one-command coordination, participant-specific ACK projection and
  cancellation/retention before wiring atomic series actions into the UI.

2026-09-19 atomic queue ownership (validation in progress):
- Shared queue captures/advances a bounded participant group atomically; one runtime
  command owns delivery. Per-resource predecessors, submitted handoff, collection
  presentation and DataSession acceptance are reused. No feature-owned outbox.
- Added scenarios: offline restart, lost ACK, two tabs, local storage refusal,
  failed predecessor, repeated moves, queued target creation, deleted target,
  later unsent text, cancellation, reference-aware compaction and multi-source add.
  Existing bulk selection requires more than two participants; the protocol now
  uses the same 100-resource bound as server relation planning.
- DataEngine integration verifies opening both participants after restart and a
  proof-aware read when the ACK omitted copies. The emulator verifies concurrent
  moves and no-op secondary proof. These remain harness/emulator evidence, not
  browser/PWA or physical-device acceptance of series UI.
- Next: finish gates/review, then add the public membership scope and migrate
  every series writer/reader together. Groups/series activation remains blocked.

- Mixed-version review reproduced `BUG-20260919-engine-old-tab-splits-atomic-action`:
  old bundles scan ordinary `request` rows and ignore new ownership fields. Atomic
  participants now live under `atomic-request` in the same database. The new reader
  and retention scanner share both ranges; the old reader sees none of the group.
  One editor generation cannot cross formats. The runtime journal remains shared
  because it already contains one complete immutable command. Red/green regression:
  `/tmp/data-engine-atomic-old-tab-{before,after}.log`.

- Atomic ownership final checkpoint: `test:fast` passes 711 suites / 7,092 tests
  (9 explicit skips); lint/types pass with the same 15 inherited warnings. Eight
  real Firestore emulator cases pass, including multi-source transfer, competing
  moves and replay. Isolated production build passes in 36.04 s including types.
  Logs: `/tmp/data-engine-atomic-commit-{tests,lint,build,focused}.log` and
  `/tmp/data-engine-atomic-ready-emulator.log`.
- Full coverage before the final payload-sharing adjustment: 711 suites / 7,091
  tests, 91.94% lines (`/tmp/data-engine-atomic-ready-coverage.log`). After that
  adjustment the full fast suite above and 41 focused tests pass; atomic coordinator
  coverage is 98.70% lines / 89.74% branches and commit storage is 100% lines.
- Review covered immutable identity, storage failure, old/new tab compatibility,
  causal predecessors, group cancellation/compaction, owner fencing, secondary
  conflict isolation, proof completeness and bounded payload duplication. The wire
  command is stored once on the root request; every participant still sees shared
  delivery status. No independent review agent was used.
- Closed `BUG-20260919-engine-old-tab-splits-atomic-action` with an old-range
  negative control. Public series membership scope and UI remain unimplemented;
  the next work is listed at the top. No production switch, rules or deploy changed.

## 2026-09-19 — legacy series preservation before activation

- Reproduced `BUG-20260919-series-legacy-replay-splits-move`: v2 stores independent
  transforms and replays a move piecemeal. A deleted target refuses its addition,
  then the source removal succeeds. Evidence: `/tmp/data-engine-legacy-membership-repro.log`;
  exact temporary test source: `/tmp/data-engine-legacy-membership-repro.test.ts`.
  The bug remains open while the old path is active.
- When series is enabled, new-bundle legacy CRUD/membership entry points refuse
  before SDK/HTTP access. Replay leaves original v2 bytes intact; recovery exposes
  owner-scoped preview/export with migration-required status. Original action
  grouping and opening versions are absent, so automatic import would invent intent.
- Series list/detail query documents and pending CRUD variables now archive before
  React Query hydrates, expires or replaces them. Ownerless deletes are attributed
  only by a unique cached owner; unknown ownership stays quarantined.
- Validation: 711 suites / 7,096 tests pass; full lint/types pass (the two new lint
  warnings were then removed and focused tests rerun: 35/35, changed modules lint clean).
  Logs: `/tmp/data-engine-series-preservation-{full,lint,after-2,eslint}.log`.
- Sequential review checked migration gating, owner separation, unchanged inactive
  behavior, exact-byte recovery and transport refusal. No new high-confidence issue
  remains in this diff. Already shipped clients are not changed by these guards.
- Next: public pinned membership scopes and all series readers/writers. Groups and
  series remain disabled for production; PWA/device acceptance remains outstanding.

## 2026-09-19 — pinned membership stages and crash-safe capture

- Public engine begin/recover/release pins the complete available series list and
  explicit saved predecessors. A selector cannot silently infer a new opening
  ancestor at Save. Typed bulk assignment/removal and exact reorder reuse the
  canonical item helpers; every changed source and the assignment target are
  captured together, including an already-satisfied target.
- Staging is durable but unsent. Save first freezes the choice; a crash resumes the
  same scope/resource/generation. Storage uses CAS and a separate range, so two
  restored tabs cannot overwrite the same stage or feed it to ordinary autosave.
  Owner changes fence values and callbacks. A queued target creation is supported.
- Review found and reproduced `BUG-20260919-membership-capture-retention-gap`:
  another editor can consume the ACK before the stage records its request IDs.
  Request creation now acquires its stage reference atomically; completion transfers
  ownership in one transaction. The regression failed with zero retained requests,
  then passed with both retained and the same IDs on recovery.
  Logs: `/tmp/data-engine-membership-retention-{before,after}.log`.
- Current gates: **713 suites / 7,120 tests pass**, 9 skipped. Lint: 0 errors /
  15 inherited warnings; unused and normal TypeScript checks pass after correcting
  the hook identity ref type. Isolated production build, councils/groups/series
  switches, passes in 20.61s (`/tmp/data-engine-membership-production-build-2.log`).
  This is compile proof only: the old series screens are not enabled safely yet.
- The broad fast run reported a worker-exit warning; direct new tests with
  `--detectOpenHandles` finish normally: **24 tests**, no handle report.
  `/tmp/data-engine-membership-handles.log`. Earlier new-module coverage was
  99.35% lines / 95.31% branches; final full coverage passes: 713 suites / 7,120
  tests, 92.05% total lines, 94.59–100% new-module lines. Two final navigation
  cases bring the focused suite to 26 passing tests, without open handles.
  Logs: `/tmp/data-engine-membership-{full-coverage,release-tests}.log`.
- Review lanes: immutable capture, uncertain-save recovery, two tabs, mixed-version
  retention, predecessor creation, target lifecycle, owner separation and React
  cleanup. No separate reviewer agent was used. No remaining high-confidence
  regression was found in this checkpoint. UI/rollout gaps are tracked separately.
- Remaining: delivery/refusal/whole-action conflict controls, integration of every
  series membership caller and CRUD reader/writer, migrated-boundary detector
  closure, browser/PWA acceptance, remaining domains and production rollout proof.

## 2026-09-19 — cascade activation boundary

- Found/reproduced `BUG-20260919-engine-cascade-bypasses-activation`: groups-only
  deletion marked a series, and series-only deletion marked a legacy sermon backlink.
  The former check validated only the command's primary collection.
- Server now refuses the entire planned write set if any actual effect is outside
  served collections. No document or feed writes happen; only the immutable refusal
  receipt is stored. Read-only references remain allowed. Prior successful ACK
  replay preserves its proof after related switches change.
- Red-to-green server proof: `/tmp/data-engine-cascade-activation-{before,after}.log`;
  93 server tests pass. Real local Firestore emulator: **10 tests / 2 suites pass**,
  including the cross-domain refusal and legacy preflight race. This is Admin
  transaction evidence, not a Security Rules test. Log:
  `/tmp/data-engine-cascade-activation-emulator.log`.
- Groups/series still cannot activate: public action delivery/conflict controls,
  all series screens/writers, sermon compatibility for legacy backlinks and the
  remaining migration/device gates are outstanding. No deployment performed.

- Final cascade checkpoint gates: **713 suites / 7,125 tests pass**, 10 skipped in
  the normal run and executed separately in the emulator. Lint: 0 errors /
  15 inherited warnings; both TypeScript checks pass. Production build passes
  in 15.35s. Logs: `/tmp/data-engine-cascade-activation-{full,lint}.log`,
  `/tmp/data-engine-cascade-production-build.log`. Sequential review checked
  no-partial-write ordering, receipt identity/replay and read-only references;
  no introduced high-confidence blocker remains.

## 2026-09-19 — complete-action discard and participant conflict ownership

- Reproduced `BUG-20260919-engine-participant-resolution-splits-action`: after
  destination deletion, a source editor could Keep Local, retire the refused move
  and later submit only its source removal. The reproduction failed before the
  guard (`/tmp/data-engine-participant-resolution-before.log`).
- Generic document choices now defer to the action owner. The queue enforces it
  independently of presentation; `describeSync` hides invalid per-document choices.
- Whole-action discard cancels every participant and dependent request in one
  revision-checked storage transaction. A changed dependent revision rolls the
  entire cancellation back; retry succeeds with current evidence.
- Cancelled projections restore membership while retaining subsequent saved or
  unsent titles. An unrelated remote title conflict stays unresolved. Closed
  editor recovery and mounted editors use the same `DataSession` rule.
- The engine validates scope ownership, refuses pending delivery, waits for local
  editor projection and permits retry after stage compaction failure.
- Sequential review lanes: ownership/public boundaries, cancellation races and
  restart, field merge/conflict retention, failure recovery, and behavior evidence.
  No independent agent was used. UI wiring and physical-platform acceptance remain
  open; no deployment or production flags changed.
- Validation: **713 suites / 7131 tests pass**, 10 skipped; lint 0 errors / 15
  inherited warnings; TypeScript and unused-symbol checks pass. Isolated production
  build passes in 19.54s. Logs: `/tmp/data-engine-action-{full,lint,build}.log`;
  focused owner/discard proof: `/tmp/data-engine-discard-owner-2.log`.

## 2026-09-19 — public membership delivery and recovery controls

- Complete-action discard checkpoint committed as `e621e553`.
- `useDataMembership` now exposes the engine's delivery summary, whole-action
  discard and identity-preserving retry. Stage durability stays separate from
  server confirmation. Account/generation and response-order fences reject old
  subscriptions and late status responses.
- The action summary and queue use one cancellation predicate, including dependent
  work. Every participant must be acknowledged before presenting success.
- Compaction retains a small owner-scoped completion outcome so a mounted/reopened
  status does not invent success from missing payloads. Earlier watermarks without
  an outcome remain explicitly unavailable. Mixed terminal outcomes do not compact.
- Retry repairs both pre-capture and completion persistence failures without fresh
  ancestry or another action ID. A completed stage never captures again.
- Validation: **714 suites / 7147 tests pass**, 10 skipped; lint 15 inherited
  warnings, both TypeScript checks pass; isolated production build passes in
  16.37s. Logs: `/tmp/data-engine-action-api-{full,lint,build,races}.log`.
- Sequential review covered ownership, failed storage, completion retention,
  lifecycle races, shared policy, and bypass boundaries. Domain UI/readers remain
  next; no live browser or physical-device acceptance claimed for this API block.

## 2026-09-19 — series list readers and durable creation

- Public action-control checkpoint committed as `eda634e2`.
- `useSeriesDataCollection` shapes the engine's confirmed/submitted collection;
  the existing `useSeries` read facade now delegates when enabled, including
  selectors and group list consumers. Legacy list queries are disabled in that
  deployment. An explicit owner mismatch yields no rows; an empty overlay cannot
  fall back to stale confirmed rows.
- Hydration/sorting moved from the SDK service into transport-free
  `seriesDocument.ts`, shared by both paths. No new data ownership logic lives in
  the adapter. The canonical client guard also runs before legacy hooks enqueue
  mutations, so offline calls cannot manufacture new legacy pending work.
- Series list creation uses `useDataDocument(create, autoSave=false)`, preserving
  raw typing immediately and capturing only on Create. Creation discovery/recovery
  is available from the list. Read errors remain inline instead of unmounting a
  draft. Required fields are validated in the form, with all three locales, so
  browser-native validation cannot silently block submission on mobile.
- Actual editor/runtime/storage-harness tests prove restart recovery, raw trailing
  space retention, one capture on Create, offline queue ownership and visible
  validation. Enabled-facade tests prove zero legacy reads/mutations and shared
  refresh. Legacy page/hook regressions still pass.
- Gates: **716 suites / 7151 tests pass**, 10 skipped; lint 15 inherited warnings,
  both TypeScript checks pass. Production build passes in 22.60s (TypeScript 23.44s).
  The final deduplication to the canonical client guard then passed 40 focused
  tests, targeted lint and TypeScript. Logs: `/tmp/data-engine-series-entry-{full,lint,build,final}.log`.
- Sequential review: shape compatibility, owner isolation, local durability,
  form lifetime/validation, old-mode behavior and shared-boundary compliance.
  No new browser/device acceptance yet. **Series detail, metadata forms, deletion,
  all membership callers and real offline navigation remain unfinished.** The
  enabled creation route must not ship before its destination detail page migrates.


### 2026-09-19 — series detail and pinned membership UI

- Shared `SeriesDetailView` preserves legacy presentation; flag-enabled detail reads
  through `DataDocumentProvider` and the canonical collection projection. Submitted
  membership is visible immediately without injecting it into an open metadata draft.
- Metadata editing uses one pinned manual scope, persists every keystroke, and sends
  only on explicit Save. Closed unsent forms remain visible on the page and are
  discoverable after restart. Disjoint remote fields survive; conflicting titles do
  not overwrite the other device.
- `SeriesMembershipDialog` opens its stage before selection or ordering controls.
  Assign/remove/reorder share `useDataMembership`; drag, keyboard and arrow controls
  edit the same durable unsent stage. Missing child documents remain represented.
- `DataMembershipStatus` presents whole-action delivery. Unknown delivery offers
  same-identity retry; only engine-proven failed actions can be discarded. Failed
  immutable receipts do not offer a misleading ordinary retry.
- Review found `BUG-20260919-membership-cancel-retry`: a failed local Cancel stayed
  cancelled in memory, but Retry skipped writing that state. Its UI regression failed
  before the shared `retryMembership` fix and passes now, with zero network sends.
- Actual engine/runtime/storage/transaction-planner UI tests prove offline move
  projection, one atomic command after restart, destination deletion preserving the
  source, reorder retaining a remote insertion, local delete capture, and unsent
  metadata recovery. Only I/O and unrelated child catalogs are replaced.
- Gates: **720 suites / 7164 tests passed**, 2 suites / 10 tests intentionally skipped;
  both TypeScript configurations pass; lint has 0 errors / 15 inherited warnings;
  isolated production build passes with councils/groups/series compiled in. The full
  Jest run reported a worker teardown warning; focused open-handle diagnostics pass (5 suites / 19 tests) without a leak report. Logs: `/tmp/data-engine-series-detail-final-{tests,types,unused,lint}.log`,
  `/tmp/data-engine-series-detail-build.log`, `/tmp/data-engine-cancel-retry-{before,after}.log`.
- Sequential review lanes: ownership/ancestry, error handling and recovery, public
  boundaries, UI regression, tests and migration compatibility. No independent agent
  was used. Remaining activation gates: other membership callers, sermon creation
  inside the selector, legacy sermon backlinks, and browser/PWA/device acceptance.
  No production flag changed. No production deployment. Fresh `origin/main` fetched
  at 07:22 is already contained in this branch.

- Live follow-up at 07:25 could not complete: Firestore returned
  `RESOURCE_EXHAUSTED: Quota exceeded` on entitlement reads, while engine HTTP
  reads timed out or returned unavailable. QA tabs and the local server were stopped.
  Source of project-wide quota consumption is not yet established. This is a live
  acceptance blocker, not a successful series test; no new QA series was submitted.
  Next critical investigation: bounded degraded-read retries and local editing while
  unrelated reads fail. `/tmp/data-engine-series-dev.log` contains the server evidence.


### 2026-09-19 — initial/closed collection failure cooldown

- `BUG-20260919-collection-first-failure-backoff` reproduced independently of live
  Firestore: ten head events after a rejected first list caused ten extra list
  requests. A closed-collection feed failure likewise bypassed cooldown.
- The collection reader now schedules failure retries for every mode, including
  unknown initial mode. Automatic head events share the cooldown; explicit refresh
  remains immediate. Success stops the timer for closed collections, while mixed
  collections retain their documented bounded sweep. Offline/hidden/unwatched
  lifecycles still suspend it.
- Both negative controls pass after the fix, alongside 70 reader/observer tests.
  A real-engine component test injects a background read error and proves that local
  creation still captures a durable request without any read/send request. The
  briefly disabled live form was not enough evidence of a creation defect; no
  speculative creation change was made.
- Final gates: **720 suites / 7167 tests**, 2 suites / 10 intentionally skipped;
  both TS configurations pass, lint 0 errors / 15 inherited warnings, isolated
  production build passes in 20.58 seconds. No worker teardown warning in this run.
  Logs: `/tmp/data-engine-read-backoff-{full,lint,types,unused,build}.log`,
  `/tmp/data-engine-first-failure-{before,after}.log`, `/tmp/data-engine-quota-local-create.log`.
- Review: lifecycle/ownership, automatic versus explicit retry, cache retention,
  protocol boundaries and failure recovery. No new server traffic or cloud config
  was used for these checks. Project quota exhaustion remains unattributed and
  live series/PWA acceptance remains open. Series UI checkpoint: `52ca503f`.

### 2026-09-19 — workspace recovery and membership entry points

- Closed membership stages are discoverable from every private page, including
  preaching mode. The recovery dialog is loaded on demand and survives navigation
  away from the originating editor. Recovery alone makes no network write.
- Engine lifecycle notifications publish completed releases. Optional closed-only
  discovery excludes active/opening/releasing scopes; exclusive recovery claims
  prevent two dialogs in one engine from owning the same stage. Durable storage
  remains the authority between different tabs. Owner/generation guards are retained.
- Group-detail assignment/unlink and sermon-menu add/move/unlink now use the same
  pinned membership dialog when series is enabled. Real-engine component tests
  verify no pre-Save request, one atomic move, and no legacy writer call.
- Gates: **721 suites / 7172 tests passed**, 2 suites / 10 tests skipped; both
  TypeScript configurations pass; production build passes in 19.55 seconds. Lint
  has 0 errors; the single new duplicate-literal warning was removed and that file
  rechecked, leaving the 15 inherited warnings. Focused layout/recovery/menu tests
  also cover the final layout adjustment outside the study workspace main region.
  Logs: `/tmp/data-engine-workspace-membership-{full,lint,types,unused,build}.log`
  and `/tmp/data-engine-workspace-membership-final-focused.log`.
- Sequential review covered ownership, account fencing, navigation, activation
  compatibility, lazy loading and error recovery. No independent reviewer agent
  was used. Still open: edit/create sermon membership callers, selector sermon
  creation, legacy backlinks, remaining domain migrations and live acceptance.
  Firestore quota exhaustion still blocks live series QA; no production flags or
  cloud settings changed. Read-cooldown checkpoint: `c1f2a746`.

### 2026-09-19 — existing-sermon editor membership

- The edit form's series field opens a pinned engine stage before showing choices.
  Selection stays durable and unsent until Save; Cancel cancels the stage. Navigation
  retains it for workspace recovery. A different sermon starts a new form lifetime.
- The form awaits only local membership capture. Legacy sermon metadata remains a
  separately reported write until that domain migrates. Retrying failed metadata
  reuses the captured membership identity instead of making another move.
- Empty complete owner lists are valid membership stages: they permit unrelated
  metadata editing and no-op cancellation/save, but cannot invent a missing target.
- Real-engine UI tests cover atomic move, a remotely deleted target preserving the
  source, Cancel, empty lists, and retry after metadata failure. Legacy modal tests
  still pass. Gates: **722 suites / 7177 tests**, 2 suites / 10 skipped; both TS
  configurations pass, lint 0 errors / 15 inherited warnings, isolated production
  build passes. Logs: `/tmp/data-engine-edit-membership-{full,lint,types-final,unused,build}.log`.
- Sequential review: pinned ancestry, independent write outcomes, no implicit retry,
  cancellation/navigation, empty lists, public imports and disabled-flag behavior.
  No production activation or live acceptance claimed. Creation remains a separate
  blocker: a UI Promise chain cannot durably own create plus membership after restart.
  The next engine extension will capture both effects as one atomic operation.

### 2026-09-19 — atomic member creation foundation

- `series-member-create` commits a new sermon/group and a pinned destination in one
  transaction. Existing creation, provenance, merge, exclusivity and collection
  activation checks are reused. Invalid/deleted/foreign destinations, occupied IDs
  and missing source notes yield no partial effect. Other membership payloads and
  their relative order cannot be edited through this command.
- Shared atomic queue ownership now accepts the new member plus destination. Local
  capture is all-or-nothing, restart uses the same identity, unknown delivery cannot
  be discarded, and each participant requires committed proof. New request rows are
  invisible to older queues; reference holds protect their saved predecessors from
  older garbage collectors until initialization.
- Gates: **723 suites / 7192 tests**, 2 suites / 13 emulator-only tests skipped in
  the regular run; all **13 emulator tests passed separately** against real local
  Firestore transactions. Both TS configurations pass, lint 0 errors / 15 inherited
  warnings, isolated production build passes in 15.85 seconds. The final validation
  refinement preserving relative order also passes 53 focused tests. Emulator proof
  is Admin transaction evidence, not a Security Rules or live-device acceptance run.
  Logs: `/tmp/data-engine-member-create-{full,lint,types-final,unused,build,emulator}.log`.
- Sequential review: absent-ID and tenant guarantees, all-or-nothing write sets,
  replay proof, domain validation, participant storage, old-tab compatibility,
  dependency retention and production activation boundaries. No independent agent.
- This foundation is not yet exposed through a creation form. Next work is the
  durable creation stage and public hook, then AddSermonModal/dashboard/series-selector
  integration. Preserve pre-Save input, stable new ID and destination pins across
  restart; old membership recovery must not reinterpret creation stages. Existing
  editor checkpoint: `44e22b94`. Live QA remains blocked by Firestore quota exhaustion.

### 2026-09-19 — durable creation stage and public facade

- `beginMemberCreation` allocates the stable resource and durable draft before any
  catalog read. `openCreationSeries` pins the optional selector separately. A failed
  series read does not prevent standalone offline creation; incomplete input stays
  editable, while complete schema validation precedes Save's immutable capture.
- The existing MembershipScope state machine owns creation too: no second outbox,
  save protocol or retry loop. `creation-scope` storage prevents older dialogs from
  restoring only its membership half. Store guards preserve the resource identity,
  pinned selection and frozen creation value; shared capture references cover the
  crash between request persistence and stage completion.
- Public `useDataMembership` exposes `beginCreate`, `updateCreation`, `openSeries`
  and `creation`. Tests prove typing/restart without reads, failed optional reads,
  fixed resource identity, selector immutability, same-ID retry after capture crash,
  old-dialog isolation, cancellation and public React staging without premature send.
- Gates: **723 suites / 7197 tests**, 2 suites / 13 emulator-only cases skipped in
  the regular run; both TypeScript configurations pass, lint 0 errors / 15 inherited
  warnings, isolated production build passes in 19.62 seconds. The final draft guard
  reuses domain policy to forbid legacy backlinks, with focused tests/types/lint
  rechecked after that refinement. Logs: `/tmp/data-engine-creation-scope-{full,lint,types-final,unused,build}.log`.
- Sequential review covered ownership, immutable identity, pre-Save validation,
  concurrent typing/selector reads, storage CAS, frozen capture and old-tab recovery.
  No independent agent. Current UI does not expose creation stages yet, and the
  membership-only workspace dialog excludes them intentionally. Next: add the
  creation form and matching workspace recovery, migrate dashboard and selector
  entry points/readers, then complete sermon/domain migration and live acceptance.
  Atomic queue/server foundation is committed as `de572d6a`.

### 2026-09-19 — creation form and whole-draft workspace recovery

- `EngineCreateSermonModal` reuses the existing sermon fields and the public stage.
  Typing is durable immediately; the series catalog is optional and opens separately.
  A planned date is part of the same new document, not a follow-up network write.
- Workspace recovery distinguishes creation from existing-member actions and opens
  the complete creation form. Both dialogs load on demand. Close preserves input;
  explicit Cancel cancels the unsent stage. The shared dialog's optional Close button
  supports that distinction without changing existing callers by default.
- Real-engine component tests prove one create/date/link command, standalone create
  after catalog failure, complete title/verse recovery after close plus restart with
  the same resource ID, and Cancel with no command or residual recovery choice.
- Gates: **724 suites / 7201 tests**, 2 suites / 13 emulator-only cases skipped;
  both TypeScript configurations pass; lint 0 errors / 15 inherited warnings;
  isolated production build passes. Prior **13 real emulator checks** remain valid:
  this checkpoint changes presentation and test I/O seams, not server processing.
  Logs: `/tmp/data-engine-creation-ui-{full,lint,types-final,unused,build}.log`.
- Sequential review: public boundary, lifecycle/account fencing, draft versus Save,
  atomic date/link ownership, optional read failure, explicit cancellation, lazy
  recovery and legacy dialog compatibility. No independent reviewer agent was used.
- Main fetched again at 08:29: `HEAD..origin/main` is empty. No push, deployment,
  production flag change or claim of live/PWA/device acceptance. Firestore quota
  exhaustion still blocks live QA and its project-wide source remains unattributed.
- Next: switch AddSermonModal/dashboard/list/series-selector creation together with
  engine collection projection and legacy cache preservation. Preselected-series
  intent must itself be durable before a catalog read; do not silently omit it on
  failure/restart. Then finish legacy sermon backlinks, all remaining domain writes,
  bypass closure, independent live/device acceptance and production rollout gates.
