# DataEngine boundary checks

New owned-document features use `DataEngineProvider`, `useDataDocument` and
`useDataCollection` from `@/data-engine/react.client`. Non-React browser integration
may use `createBrowserDataEngine` from `@/data-engine/browser.client`. Import editor
and document types with `import type`; do not construct transports, checkpoints,
journals, observers or server processors inside a feature.
The shared `DataSyncStatus` component is also a public presentation seam.

SDK access belongs in the canonical adapters: `data-engine/server.ts` and the
read-only `data-engine/source.client.ts`. The staged `legacyBoundary.server.ts` adapter
allows only its exact reviewed legacy server callers to finish unmarked-document
operations. It reads every target within the transaction and refuses any existing
protocol marker; it is not a new-feature API.

The existing `OutboxConflictBanner` alone may read `legacyRecovery.client` to discover
and export old pending writes. This migration-only edge grants no write bypass. The four existing DataEngine HTTP routes
may import the server adapter. Adding a similarly named route does not grant that
permission. Application runtime imports from `test-utils` are forbidden.

Use the engine save/edit lifecycle for mutations. Calling `/api/data-engine/commands`
with `fetch` bypasses its durable journal just as calling an old document-write route
bypasses it. AI endpoints that only return proposals, such as brainstorming or the
study-note cutter, are distinct from persisted document updates.

Run from `frontend`:

```sh
npx jest --runInBand --runTestsByPath __tests__/architecture/dataEngineBoundary.test.ts
```

On failure, use the reported source/capability and line to move the operation into
the existing engine path. For an existing migration, remove its entry or lower the
count in `legacyFirestoreAccess.json`. Do not increase a count or add an exemption
to make a new consumer pass. The JSON contains separate inventories of pre-existing
SDK calls, runtime capabilities and known legacy HTTP writes; these are migration
debt, not evidence that existing screens have migrated. A reviewed atomic-boundary migration may replace old direct calls with transactional
reads and writes; document the precise movement and refresh only those entries.

The detector uses TypeScript signature/module resolution, including aliases and
reexports. Negative controls cover runtime capabilities passed as callbacks,
literal dynamic/CommonJS imports, constant/template URLs, HTTP aliases, `Request`
objects, and literal route arguments passed through one local HTTP wrapper.
Type-only imports, public engine imports, unrelated `Map.set`, read requests and
known proposal-only routes are controls against false positives. The legacy plan
GET with a `section` query writes data and is detected, including local `URL.searchParams`
construction; the plan GET with only `outlinePointId` remains a proposal.

This is an architectural regression gate, not whole-program security verification.
It cannot prove arbitrary computed module names or URLs, `any`-erased SDK handles,
reflection, untyped dependencies, or custom wrappers with runtime-selected routes.
Counts also do not prove the semantics of a replacement operation within an already
budgeted file. Review those changes and keep transaction, replay, browser and rules
tests as independent evidence. New legacy write routes must be added to the detector's
explicit endpoint recognition before claiming coverage for them.

Architecture and rollout status: [proposal](../../../docs/architecture/data-engine-proposal-2026-09-12.md)
and [implementation plan](../../../docs/architecture/data-engine-implementation-plan.md).

The staged sermon guard migration moved existing writes into the legacy bridge and
added transactional cascade reads. The detector also now counts Admin `create`;
three pre-existing calls (councils repository, service-orders repository and custom
order route) were verified in the pre-change checkout and added as discovered debt.
