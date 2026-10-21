when: search query URL · nuqs · delayed router.replace · search resets tab · search cancels navigation · поиск сбрасывает вкладку · поиск отменяет переход

# Keep search in the URL without starting a page navigation

Use `frontend/app/hooks/useSearchInputQuery.ts` for an authored search input. It reuses the Studies input mirror while the installed Nuqs adapter owns shallow query updates, history merging, rate limits and queue resets. Sermons uses `q` with its existing blank-query policy; Studies uses `search`. A tab that belongs in browser history uses `useQueryState` with a pushed update. Do not add a delayed `router.replace` effect: it can override a tab or card selected later.

Keep the input immediate and defer expensive list work through the existing page mechanism. Preserve unrelated query parameters and hashes. A mocked query writer proves component behavior only; it does not model the installed Next/Nuqs navigation queues. Test an actual compiled route with quick typing followed by a tab or card, plus clear/Escape, reload, Back and warm offline. Use the emulator recipe and close owned browsers and unused servers.

Explicit browser Back/Forward is a new user choice even while the search field is focused. The shared hook adopts the string query from that popstate without writing it back. Ordinary late query snapshots still respect the focused local mirror so typing and Escape cannot revive old letters; Nuqs remains the owner of URL writes and navigation queues. `BUG-20261020-offline-sermon-scroll-landing` tracks the observed offline viewport offset. A visible DOM heading is not proof that the heading intersects the viewport; measure the rectangle and inspect the original frame. Keep fixes in the shared owner of each mechanism.
