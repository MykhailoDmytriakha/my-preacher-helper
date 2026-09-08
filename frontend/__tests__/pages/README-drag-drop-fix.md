# Structure drag-and-drop verification

The active structure page delegates to `app/(pages)/(private)/sermons/[id]/structure/hooks/useStructureDnd.ts`. Its tests live beside that hook under `__tests__`.

- `useStructureDnd.test.ts`: item/point/subpoint targeting, order, persisted payloads, no-op drops and refusal rollback.
- `useStructureDnd.preview.contract.test.tsx`: real React state/ref preview, animation-frame coalescing, no network writes while hovering, cancellation before/after a frame and invalid targets.
- `structure/utils/__tests__/collision.test.ts`: actual target selection and overlap boundaries.
- `__tests__/components/ThoughtLanes.test.tsx`: target IDs, subpoint gaps, nearest item metadata and renderer ownership.

From `frontend`, run `npx jest --runInBand --runTestsByPath 'app/(pages)/(private)/sermons/[id]/structure/hooks/__tests__/useStructureDnd.test.ts' 'app/(pages)/(private)/sermons/[id]/structure/hooks/__tests__/useStructureDnd.preview.contract.test.tsx'`.

The former `utils/dnd-handlers.ts` and three obsolete suites were removed in the September 2026 refactor. That implementation had no application callers; one suite tested local copies of the handlers. See `docs/codebase-refactoring-2026-09-07.md` for the behavior crosswalk and negative-control evidence. Tests do not substitute for actual pointer/touch/layout checks.
