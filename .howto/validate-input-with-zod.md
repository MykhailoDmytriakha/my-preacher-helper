when: zod · validate request body · validate input · safeParse · z.infer · schema type drift · strict() unknown field · zod datetime offset · z.string().datetime({ offset: true }) · +99:99 accepted · invalid timezone offset · validate ISO timestamp · Date.parse NaN · promotion expiresAt · external data validation · 400 bad request body · валидация · проверка входных данных · проверить тело запроса · схема zod · неизвестное поле · часовой пояс · проверка даты · неверное тело запроса

# Validate input with zod

Parse every value that crosses a boundary — request bodies, route params, AI output — with a zod schema, and use the schema's inferred type. The reference route is `frontend/app/api/admin/users/[uid]/entitlement/route.ts`.

## How

- Routes: `schema.safeParse(await request.json().catch(() => null))`; on failure answer 400 before any read or write. `.strict()` rejects unknown fields at every level. Same pattern in `frontend/app/api/councils/route.ts`.
- Types come from the schema: `export type X = z.infer<typeof XSchema>` next to it (`frontend/app/config/schemas/zod/thought.zod.ts`) — never a hand-written twin that can drift.
- AI output is parsed by the SDK against its zod schema — `.howto/call-ai-with-structured-output.md`.
- ISO timestamps that matter (expiry, period anchors): `z.string().datetime({ offset: true })` checks the shape and requires an offset, but accepts an impossible one like `+99:99`. Add `.refine((value) => !Number.isNaN(Date.parse(value)))` — the native parser rejects what cannot be a real instant. The two checks close different gaps; keep both. Regression rows (garbage, no offset, `+99:99`) are in `frontend/__tests__/api/admin/entitlementRoute.test.ts`.
- Coverage is partial: 9 of 58 API routes import zod. Don't copy a neighbour that reads `request.json()` raw; give it a schema when you touch it.

## Why

- 2026-07-12: `+99:99` passed Zod's datetime check and an invalid promotion expiry reached Firestore.

See also: `.howto/gate-and-meter-an-ai-call.md`
