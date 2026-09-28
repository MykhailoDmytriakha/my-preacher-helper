when: params should be awaited before using its properties · await params · Next.js 15 params · params is a Promise · Promise<{ id: string }> · route handler params · dynamic route id · [id] · useParams · useRouteId · generateMetadata params · opengraph-image params · id missing offline · /~offline · параметры маршрута · params это Promise · id из адреса · динамический маршрут · дождаться params · id пропал без сети

# Read route params

In Next.js 15 (`frontend/package.json`: `next` ^15.5) the `params` of a route handler, page, layout and `generateMetadata` is a Promise: type it `Promise<{ id: string }>` and `await params` before use. Client pages read the id with `useRouteId()` or `useParams()` instead.

## How

- Route handler: `export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> })`, then `const { id } = await params;`, as in `frontend/app/api/sermons/[id]/brainstorm/route.ts`.
- `generateMetadata` gets the same Promise (`frontend/app/(pages)/share/notes/[token]/layout.tsx`).
- In tests, call the handler with `{ params: Promise.resolve({ id: 'x' }) }` (`frontend/__tests__/api/admin/entitlementRoute.test.ts`).
- Client detail pages: `useRouteId()` from `frontend/app/hooks/useRouteId.ts`. It is `useParams().id` plus an offline fallback: inside the offline shell the router context is `/~offline` and `useParams()` has no id, so it reads the id from `window.location.pathname`. It returns `''` when nothing resolves; guard data hooks on a falsy id.

## Traps

- `useRouteId` falls back to the second path segment, so it only fits `/<section>/<id>` routes. Deeper routes (`/care/orders/[id]`, `/care/council/[id]`) call `useParams()` directly and have no offline fallback.
- Metadata image routes are the exception in Next 15: the default export of `opengraph-image.tsx` receives `params` as a plain object (Next's metadata route loader awaits it first). `frontend/app/(pages)/share/notes/[token]/opengraph-image.tsx` types it that way; its `await` on a plain object is harmless.

## Why

- Next.js 15 made `params` asynchronous. Synchronous `params.id` still works for now, but Next logs in development: `params` should be awaited before using its properties.
