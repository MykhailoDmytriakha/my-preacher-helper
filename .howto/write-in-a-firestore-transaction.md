when: Firestore transaction · runTransaction · runLegacyTransaction · transaction.update · tx.update · repository method inside a transaction · docRef.update inside transaction · Legacy mutation requires a transactional target read · Legacy transaction reads must precede writes · Legacy bridge requires an object patch · Legacy cascade exceeds its atomic write budget · data-engine-required · 426 · transaction fails offline · transaction callback runs twice · updatedAt inside a transaction · rev counter inside a transaction · транзакция · транзакция Firestore · атомарное чтение и запись · транзакция не работает офлайн · колбэк транзакции выполняется дважды · счётчик ревизии в транзакции

# Write inside a Firestore transaction

On the server, a multi-document read-modify-write runs through `runLegacyTransaction` (`frontend/app/data-engine/legacyBoundary.server.ts`), and every read and write is made on the `transaction` object it hands you — never through a repository helper, which opens its own transaction. In the browser an own-document field write already runs its transaction inside `conflictSafeUpdate`; do not open another (`.howto/write-a-document-field.md`).

## How

- Inside the callback: `transaction.get(ref)` for every document you will write, then `transaction.update(ref, patch)`. Helpers such as `updateLegacyDocument`, `mutateLegacyResource` or a plain `docRef.update()` each run their own write, so calling them inside yours is not part of it — the atomicity is gone.
- `runLegacyTransaction` enforces the discipline: all reads before the first write; a write only to a document read in this same transaction; a plain object patch; at most 100 writes. A target the data engine owns (it carries the `_dataEngine` marker) or a collection closed to legacy writers refuses with `data-engine-required`, answered as HTTP 426 by `legacyBoundaryResponse`.
- The callback can run more than once: Firestore retries it with fresh reads when a document changed mid-flight. Compute the patch only from what THIS run read; no side effects outside it and no values carried in from an earlier read. Example: `deleteSermonAndDetachFromAllSeries` in `frontend/app/api/repositories/series.repository.ts`.
- Stamp like the rest of the data: `updatedAt: new Date().toISOString()` (readers parse a string, `frontend/app/utils/readFreshness.ts`), and advance the aggregate's counter with `FieldValue.increment(1)` on `rev.<aggregate>` for every content change — `mutateLegacyResource` does it when given an aggregate, the series cascade bumps `rev.items`.
- Only reviewed server writers may import it (or `frontend/app/data-engine/serverEdit.server.ts`): `LEGACY_BOUNDARY_CALLERS` in `frontend/__tests__/architecture/firestoreBoundary.ts`, checked by `frontend/__tests__/architecture/dataEngineBoundary.test.ts`. It is a migration bridge, never a feature API. A server-computed result for a document the engine may own goes through `writeOwnedDocument`: it tries the legacy road and, on refusal, sends the same change as an engine command.
- Browser side: a transaction needs the server — offline it rejects and never enters Firestore's write queue, which is why `conflictSafeUpdate` stores an offline intent in the outbox instead. A new client `runTransaction` or `tx.update` is counted by `frontend/__tests__/architecture/writesGoThroughTheInterface.test.ts`.
- Several writes with no read, or that must also work offline: a batch — `.howto/save-several-documents-atomically.md`.

## Why

- 2026-03-03: single-document repository methods that call `docRef.update()` could not be reused inside a transaction; the operations had to be issued on the transaction object for the transaction to cover them.

See also: `.howto/write-a-document-field.md` · `.howto/save-several-documents-atomically.md` · `.howto/link-two-entities.md`
