when: window is not defined · ReferenceError: window is not defined · hydration mismatch · Hydration failed · window.innerWidth · mobile default state · is mobile · phone vs desktop · collapsed on mobile by default · innerWidth < 640 · Tailwind sm breakpoint · matchMedia · useMediaQuery · useWideViewport · useRoomyHeader · viewport width in JS · ширина экрана · телефон или компьютер · мобильная версия по умолчанию · window не определён · ошибка гидратации · несовпадение при гидратации · брейкпоинт · медиазапрос

# Detect the viewport safely

Code in a `'use client'` component still runs on the server during the first render, where `window` does not exist. Read the width only behind `typeof window !== 'undefined'`, and when the component itself is server-rendered, start from the server's value and correct it after mount with `useMediaQuery` (`frontend/app/hooks/useMediaQuery.ts`).

## How

- Mobile check: `typeof window !== 'undefined' && window.innerWidth < 640` — 640px is Tailwind's `sm` boundary (the project keeps Tailwind's default screens, `frontend/tailwind.config.ts`). The guard stops the server crash ("window is not defined").
- Device-specific default state (collapsed sections on a phone): compute it in a lazy `useState(() => ...)` initializer so it runs once. `SermonOutline` does this: `expandedOutline` opens the introduction/main/conclusion sections only when the width is at least 640px, saving vertical space on phones (`frontend/app/components/sermon/SermonOutline.tsx`).
- The guard alone prevents the crash, not a hydration mismatch: if the component renders on the server, the server takes the fallback branch and a phone takes the other, so the first client render differs from the HTML. Reading `window.innerWidth` during render is safe only in a component that first renders on the client. Private screens are: `ProtectedRoute` (`frontend/app/components/ProtectedRoute.tsx`, wrapping the private layout) starts with `isCheckingAuth = true` and renders only a spinner on the server. Public pages (landing, shared links) get no such cover.
- For a component that does render on the server, use `useMediaQuery(query, initial)`: state starts at `initial` (what the server rendered), an effect reads `matchMedia` and corrects it, and a `change` listener follows later resizes. Named wrappers: `useWideViewport()` (`lg`, 1024px) and `useRoomyHeader()` (`sm`, 640px) in `frontend/app/hooks/useWideViewport.ts`.
- Use the JS flag when only ONE of two layouts may be mounted (blocks with live inputs and pickers must not exist twice); for pure styling, a Tailwind breakpoint class needs no JS at all.

## Why

- 2026-02-26: sermon outline sections started expanded on phones and pushed the content down; the default became "collapsed below 640px", read SSR-safe.

See also: `.howto/follow-os-theme.md`
