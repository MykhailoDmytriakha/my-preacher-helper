# DataEngine migration — working queue and closing log

Started 2026-09-12 on branch `data-engine`, worktree `2767/my-preacher-helper`,
baseline commit `35abc917`. This file is the hand-off record: what is being
migrated, in which order, what is already closed and with which evidence.

## Read this first — where the work stands on 2026-09-19

**Active continuation, 2026-09-19 (Codex).** Resumed from clean `62dde054` after the
Opus/Fable hand-off. Production readiness is still open. The current local work
prioritizes shared data safety before more domain adapters. Progress is also tracked
by `el` in this worktree, case `2026-09-19-data-engine-production-readiness`.

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
- Next: measure cost and decide safe receipt/feed retention before further migrations.
  Recovery of an original unsent fork still leaves its source available, as the UI
  explains; retirement/active-tab distinction needs an explicit lifecycle design.
  The eleven
  remaining domains, recovery lifecycle, cost/retention policy, rules rollout
  and physical-device acceptance are still outstanding.

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
Production rollout and legacy draft preservation remain open.

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

1. Preserve legacy persisted council drafts and review mixed-version rollout safety.
2. Measure engine reads/writes and decide safe receipt/change-feed retention.
3. Migrate remaining domains with per-domain behavior and boundary gates; groups
   carries two audited data-loss paths and shares councils' embedded-array shape.
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
| No cost measurement | — | Reads and writes per session under the engine have never been measured against the Firestore quota |

### Domains

"Ops" counts exported functions in the domain's legacy write service — the surface
that has to move. "State" is what exists today, measured by imports, not by intent.

| Domain | Ops | State today | What it still needs |
|---|---|---|---|
| Councils | 6 | Create/read/update/delete, carry, readers and held-outcome manual forms integrated behind the collection switch; current browser and regression evidence above | Retention/cost proof, recovery lifecycle and rollout/device gates |
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
