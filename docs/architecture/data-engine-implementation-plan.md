# DataEngine implementation and verification

Owner authorized autonomous PLAN, EXECUTE, testing, review and local validation on 2026-09-12. User acceptance follows later. Baseline commit: `1aa2f34c`; preimplementation audit artifacts backed up under `.sessions/data-engine-preimplementation`. No production rules, schema or billing change before compatible server/client and migration evidence exist.

## Ordered delivery

| Step | Deliverable / dependencies | Owner / tool | Acceptance |
|---|---|---|---|
| 1 | Shared versioned command/result contract and deterministic conflict-preserving reducer | Primary / code editing + behavior probes | Independent sibling edits survive; same-field conflict preserves versions; deletion cannot resurrect |
| 2 | Server transaction + durable receipt + authorized read/list/command routes, depends on 1 | Server agent / code editing | Duplicate/lost-ACK replay, payload mismatch, ownership, tombstones, dependencies, stale command refusal |
| 3 | Client durable journal, session state and scheduler, depends on 1 | Client agent / code editing | Storage refusal, restart, later draft vs earlier ACK, late owner response, conflict recovery, transport unknown |
| 4 | Vertical production consumer and real local integration, depends on 2+3 | Primary / integration + measurement | Original scratch loss becomes green through real path; emulator + two browser contexts |
| 5 | Migrate domain services/readers/editor consumers and auxiliary CRUD in bounded groups | Primary and bounded agents / code editing | Explicit domain matrix; no hidden legacy transport writer; preserve existing UX contracts |
| 6 | Structural/behavioral bypass detector and recovery UI; compatible migration/rules gates | Primary / code editing + negative controls | Aliased imports, raw write endpoints, missing policy/receipt, early draft clearing fail appropriate gates |
| 7 | Full regression, coverage, lint/types/build; independent code review and repairs | Primary + independent reviewer / measure + refute | Full required checks green, changed-file coverage recorded, findings addressed |
| 8 | Available-environment browser/PWA validation and honest delivery | Primary / browser + closing | Cold start, offline/reload, multi-context, conflicts/deletion, unknown response; physical-device limits stated |

## Task state
- [x] Shared contract/reducer (direct behavior tests; independent review continues)
- [x] Server protocol/routes (real emulator proof; compact-receipt cost repair in progress)
- [x] Client journal/session/runtime (real browser/IndexedDB recovery and lost-ACK proof)
- [ ] Vertical integration and adverse-scenario regression
- [ ] Sermon core/preparation/thoughts/outline/structure/scratch/plan/calendar
- [ ] Studies/notes, groups/calendar, series/membership
- [ ] Prayers/journal, councils, service orders
- [ ] Settings/templates/tags and server-side CRUD/auxiliary surfaces
- [ ] Detector/recovery/migration gates
- [ ] Full checks, review and available browser validation

The narrow first slice validates the proposed protocol before broad migration. The scope remains all audited domains; a successful slice is not completion. Every new runtime module has a direct test seam. Existing baseline: 29 suites / 425 passing tests and five adverse failures; this is not a substitute for the final full suite. New protocol activation and legacy writer rejection must be coordinated; rollback must never re-enable a writer that ignores committed tombstones/receipts.

### Checkpoint 2026-09-12 15:02

Latest main fast-forwarded to `4c6360ab`; the three upstream commits and all task
artifacts were retained without conflict. Core, server and client exist, but the
whole-app cutover remains incomplete. The production gate stays off.

- Scratch hook, shared status/recovery UI, gated private provider and page branch
  are implemented. The enabled page reads the shared document directly; the temporary
  React Query compatibility projection has been removed.
- All editors on one sermon page will share `DataDocumentProvider`, rather than
  maintain parallel baselines for title, preparation and scratch.
- Structural guard now detects typed SDK capabilities, internal runtime imports,
  legacy HTTP writes and test-fixture imports, with negative controls. Existing
  debt: 243 non-adapter SDK calls, 237 runtime capabilities, 29 legacy HTTP writes.
  These counts are an inventory of remaining migration work, not completed coverage.
- Independent review reproduced failed local Retry; both regression cases now pass.
- Compact acknowledged receipts are replacing per-autosave full-document copies.
  Exact conflict receipts, feed retention and measured write/read budgets still need
  their final operational policy; no free-quota guarantee has been established.
- Required full coverage/lint/build and final independent review remain outstanding.
  Earlier full-suite run was not frozen and did not pass its aggregate coverage gate.


### Checkpoint 2026-09-12 15:38

- Explicit UI Save now uses the atomic public `commit(updater)` boundary: 64 direct
  React/domain-hook tests pass, including later typing during deferred persistence.
- The core immutable commit-request queue is being integrated. Whole-request
  successor delivery, relation-plus-ordinary saves and terminal storage retention
  remain under review; earlier foundation checks do not certify these new paths.
- Manual forms require pinned open-time context separate from document autosave.
  Their engine-owned scopes are being designed before controls are activated.
- Legacy queued writes receiving migration refusal remain recoverable. Discovery,
  full preview/copy/export and owner separation pass 49 tests; old incomplete v1
  baselines are never inferred from current server data or automatically retired.
- Firestore Rules checks pass 187 scenarios, including an offline SDK full-set
  queued before the document migrated. Server route/bridge checks pass 235 tests;
  an actual emulator transaction proves an in-flight legacy writer cannot overwrite
  a newly engine-managed document. These are local proofs, not deployed changes.
- The whole-app migration and final required aggregate gates are still incomplete.
