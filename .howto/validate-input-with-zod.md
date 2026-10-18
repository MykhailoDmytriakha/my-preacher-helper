when: Field is not writable · Invalid field change · note recording IDs refused · zod · validate request body · validate input · safeParse · z.infer · schema type drift · strict() unknown field · zod datetime offset · z.string().datetime({ offset: true }) · +99:99 accepted · invalid timezone offset · validate ISO timestamp · Date.parse NaN · promotion expiresAt · external data validation · 400 bad request body · валидация · проверка входных данных · проверить тело запроса · схема zod · неизвестное поле · часовой пояс · проверка даты · неверное тело запроса · resourceSchemas · legacy child identities · duplicate plan points · старые повторяющиеся пункты

# Validate input with zod

Parse every value that crosses a boundary — request bodies, route params, AI output — with a zod schema, and use the schema's inferred type. The reference route is `frontend/app/api/admin/users/[uid]/entitlement/route.ts`.

## How

- Routes: `schema.safeParse(await request.json().catch(() => null))`; on failure answer 400 before any read or write. `.strict()` rejects unknown fields at every level. Same pattern in `frontend/app/api/councils/route.ts`.
- Types come from the schema: `export type X = z.infer<typeof XSchema>` next to it (`frontend/app/config/schemas/zod/thought.zod.ts`) — never a hand-written twin that can drift.
- AI output is parsed by the SDK against its zod schema — `.howto/call-ai-with-structured-output.md`.
- ISO timestamps that matter (expiry, period anchors): `z.string().datetime({ offset: true })` checks the shape and requires an offset, but accepts an impossible one like `+99:99`. Add `.refine((value) => !Number.isNaN(Date.parse(value)))` — the native parser rejects what cannot be a real instant. The two checks close different gaps; keep both. Regression rows (garbage, no offset, `+99:99`) are in `frontend/__tests__/api/admin/entitlementRoute.test.ts`.
- Coverage is partial: 9 of 58 API routes import zod. Don't copy a neighbour that reads `request.json()` raw; give it a schema when you touch it.

## Existing resource documents

- The DataEngine validates the merged candidate in `frontend/app/data-engine/resourceSchemas.ts`; ordinary commands pass the trusted previous snapshot through `protocol.ts`. This admission is different from parsing an untrusted request envelope: create stays strict, unknown/malformed data is not silently normalized, and writes preserve authored words.
- Document-schema admission and writable-field admission are separate checks. An existing optional field can validate in `resourceSchemas.ts` yet be refused by both create/update envelopes unless the canonical `protocol.ts` collection policy admits it. Note recording identity uses `dictationSourceIds` and `recordingSourceIds`; keep both as schema-validated ID arrays through the shared policy. Test preparation, server application, create, malformed/unknown fields and owner denial together (`data-engine/__tests__/noteRecordingReceipts.test.ts`). Do not drop provenance or weaken all writable fields to repair one omission. Field admission does not prove delivery or authorize recording cleanup.
- The22 `children(...)` schemas and outline-wide uniqueness check tag identity violations through `legacyChildIdentity.ts`. An update may retain only defects with the same identity/count in the same parent-list scope and duplicate rows held as an unchanged multiset subset. Authored duplicate rows cannot be rewritten or replaced by extra copies of another row. A unique parent is addressed by its ID, not its array position. Indistinguishable duplicate parents require an unchanged same-ID peer-group witness; structural edits there stay conservative. Other schema errors never receive that allowance, and a missing baseline grants none.
- Transaction relation staging uses its trusted current value as the prior baseline; old material sections remain repairable during note unlink/delete through the internal derivedSectionNoteIds projection, which ignores only section noteIds when comparing retained rows; all authored fields stay protected. Ordinary commands cannot request this projection. Council carry tolerates held nested question/option defects, because copies receive fresh IDs, but topic addresses stay unique through the shared `childIdentityIssues` detector. Flat series membership addresses and new-document checks remain strict. Never use a client-supplied ancestor or the candidate itself as the trusted baseline, deduplicate authored data, or skip an entire preparation schema.
- Regressions: `frontend/app/data-engine/__tests__/legacyChildIdentity.test.ts` runs actual `applyCommand` for preparation, council and outline edits, repair, parent reordering, ambiguous parents, newly introduced/increased/moved duplicates, malformed fields and create. `frontend/__tests__/data-engine/serverRelations.test.ts` also covers carries beside/containing old question duplicates, fresh copy IDs, strict topic addressing and material unlink with retained section words.

## Why

- 2026-07-12: `+99:99` passed Zod's datetime check and an invalid promotion expiry reached Firestore.

See also: `.howto/gate-and-meter-an-ai-call.md`
