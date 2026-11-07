when: new page · add a page to navigation · nav item · primaryNavItems · navConfig · matchers · isNavItemActive · active tab lights the wrong item · two nav items lit · breadcrumb shows id · breadcrumb shows an English word · Breadcrumbs · segmentLabels · detailParents · detailLabelResolvers · back button · BackLink · router.back · hide nav on a full-screen page · focus mode · useShellPathname · DashboardNav · MobileMenu · новая страница · пункт меню · навигация · хлебные крошки · подсвечен не тот пункт · кнопка назад · скрыть меню на полноэкранной странице · мобильное меню

# Add a page to navigation

Nav items come from one list, `primaryNavItems` in `frontend/app/components/navigation/navConfig.ts`; the desktop bar (`DashboardNav.tsx`) and the phone menu (`MobileMenu.tsx`) both render it. The breadcrumb trail is global: the private layout `frontend/app/(pages)/(private)/layout.tsx` renders `Breadcrumbs` once, and a page adds words to it, not a trail of its own.

## How

- A nav item is `key`, `href`, `labelKey` (`navigation.<key>` in all three locale files under `frontend/locales/`), `defaultLabel`, `icon`, `matchers` (regexes on the pathname) and an optional `theme` (a `NavItemThemeKey` from `frontend/app/utils/themeColors.ts`). `isNavItemActive` lights every item whose matcher matches.
- One path, one owner. When a page stops being a redirect or alias and becomes its own workspace, give it its own item and matcher and take its path out of the other item's regex. Deliberate nesting is written down where it lives: `care` also matches `/prayers`, because the prayer journal is a room inside that section.
- Static segment in the trail: add it to `segmentLabels` in `frontend/app/components/navigation/Breadcrumbs.tsx` (label key, default, optional href). Without an entry the URL word is title-cased into the trail, an English word inside a Russian interface (`manual` has an entry for exactly this).
- Id segment in the trail: add the parent to `detailParents` (the generic word shown while loading) and `detailLabelResolvers` (the entity's title), and read the entity through its hook (`useSermonRead`, `useSeriesDetail`, `useGroupRead`, `usePrayerDetail`), never an inline query or service call. The hook owns the cache-first lookup in the list plus the fallback fetch, and tests mock the hook as the seam (`frontend/__tests__/components/navigation/Breadcrumbs.test.tsx`).
- A council screen publishes the title of its open document through `usePublishShellTitle`. The trail reads `useShellTitle` and shows the generic label until that screen has its copy. A list row may be a different saved version.
- Child route under an id (`/x/:id/child`): give the last segment its own label entry and keep the id segment resolving to the title, so `/x/:id` itself renders as before.
- Before adding page-level navigation, look at what the layout already shows. A page with a better way back opts out of the trail instead of showing two: `Breadcrumbs` returns nothing under `/studies/<anything>`, because the note page's arrow keeps the list's search and filters.
- Back button: `BackLink` (`frontend/app/components/settings/BackLink.tsx`) calls `router.back()` when `window.history.length > 1`, else `router.push(to)`.
- Full-screen page without chrome: derive a flag from the route in the private layout (`isPreachingPlan` hides `DashboardNav` and the trail) and let the page own its width and padding. Do not hide chrome by rewriting breadcrumb labels or touching unrelated routes. A focused page that still wants the trail renders `Breadcrumbs` with `forceShow` itself (`PlanPreachingView.tsx`).
- Read the path with `useShellPathname`, not `usePathname`: inside the offline shell the router reports `/~offline`, and nothing would light up.
- A sermon mode action uses `getSermonModeUrl` in `frontend/app/utils/urlUtils.ts` and the existing `router.push(..., { scroll: false })`, as the header does. Copy the current query and replace only `mode`; changing a local pane alone leaves the selected header and history behind. Keep editors mounted. Verify both empty and nonempty thought-list entrances, selected header state, actual return, draft retention, reload and Back/Forward; a translated panel is ready for the next input only when its actual active edges align with the frame, even if several mid-animation samples are identical.
- Add a settings section to `utils/settingsSections.ts` and connect its existing page to `LAZY_ROUTES` in `app/~offline/page.tsx` with `SettingsSectionLayout`. The shared route type includes every section, so a missing mapping blocks the production build (TS2741) and a previously visited SPA screen falls back to the generic card on offline reload. Extend `__tests__/pages/offlineShell.engine.test.tsx` with its rendered page/frame and signed-out control, then verify the actual menu visit followed by an offline reload; a full online document visit may cache HTML and hide a missing shell route.

## When it goes wrong

- Two tabs lit, or the wrong one: two items' `matchers` cover the same path; the header title takes the first match (`currentNavItem`). Give the path one owner. Tests: `frontend/__tests__/components/navigation/DashboardNav.activeState.test.tsx`.
- The trail shows an id or a raw URL word: the segment has no `segmentLabels` entry, or its parent has no resolver.

## Why

- 2026-04-28: a page promoted from alias to its own workspace stayed inside another item's regex; routing was right and the lit tab was wrong.
- 2026-05-22: breadcrumb lookups moved into entity hooks, so each hook owns its cache-first lookup and fetch, and tests have one seam to mock.

See also: `.howto/move-a-route-url.md`
