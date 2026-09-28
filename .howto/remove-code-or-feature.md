when: delete dead code · remove a feature · deprecate a feature · orphaned props · unused prop · grep to zero · broken imports in tests after delete · Cannot find module after deleting a file · dead barrel · module with 0% coverage and no consumers · remove server fallback · delete an API route · stale mocks · deprecated tags come back · structural tags · vercel.json entries pointing at deleted files · удалить мёртвый код · убрать фичу · удалить функцию · неиспользуемые пропсы · сломанные импорты после удаления · удалить маршрут API · зачистка

# Remove code or a feature

A removal is done when a grep for every removed name returns zero across runtime code, BOTH test trees (`frontend/__tests__/` and co-located `app/**/__tests__/`), mocks and docs, and `npm run lint:full` plus the full `npm run test:fast` are green.

## How

- Before deleting a utility or hook stack, grep `frontend/app` and `frontend/__tests__` for the module names AND their exported symbols. Direct store or projection tests outside the requested file list become broken imports; delete or rewrite them in the same change.
- Props, in this order: interface → destructuring → usages (grep) → tests. Then remove the props that removal orphaned, cascading upward.
- Proof that a layer is dead: zero inbound references outside its own dead barrel, compile passes after deletion, and fresh coverage no longer lists it. Then delete it; do not exclude it from coverage or write tests for it. That is how the plain `config/schemas/*.schema.ts` layer went; only `frontend/app/config/schemas/zod/` remains.
- Removing a behaviour that flows through a chain (structural section tags on thoughts, for example) means removing the whole propagation chain: prompt, available and example inputs, model output, manual writes, updates, legacy reads, telemetry fields, model fields, mocks, docs. Sanitize at every boundary so stored data or model drift cannot bring it back: `stripStructureTags` / `sanitizeThoughtTags` in `frontend/app/utils/thoughtTagSanitizer.ts`. Rewrite consistency checks so data without the removed thing is valid, while legacy collisions and mismatches stay visible.
- Update every unit and hook test that asserted the old values (the removed field now null, the removed list now empty), so no suite still depends on the removed mechanism.
- Server fallbacks after a client-SDK migration: classify by operation, not by file. Delete only handlers and routes proven dead; keep cascade, AI, public-share, embedded-array and replay/idempotency server paths. Then scan services and tests for stale URLs and flag branches (`NEXT_PUBLIC_USE_CLIENT_*`).
- Deleting a route: remove its `frontend/vercel.json` entry too; `frontend/__tests__/config/vercel-functions.test.ts` fails on entries that point at deleted files.
- `npm run lint:unused` (`noUnusedLocals`) finds locals the removal left orphaned.

## Why

- 2026-06-14: tests of an orphaned hook stack lived outside the listed deletion set and became broken imports.
- 2026-05-19 and 2026-05-31: removing section tags by prompt edits alone was not enough; stored data and model output could reintroduce them until every boundary sanitized.
- 2026-02-27: excluding a dead layer from coverage, or writing tests for it, keeps dead code alive; the three-part proof is what makes deleting it safe.

See also: `.howto/measure-test-coverage.md` · `.howto/move-a-route-url.md`
