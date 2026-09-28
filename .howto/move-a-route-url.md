when: move page to a new URL · move a route · rename a route · redirect old URL · old link points to the old route · bookmark breaks · legacy URL · ?section= · replace a placeholder /new route · /studies/new · direct create shortcut · router.replace · sectionFromLegacyName · settingsSectionHref · grep hardcoded links · перенести страницу на новый адрес · сменить URL · переименовать маршрут · редирект со старого адреса · старая ссылка · закладка сломалась · жёстко прописанные ссылки

# Move a route to a new URL

Grep every hardcoded reference first, move the content to the new URL, keep the old URL alive as a redirect, and update tests last. The live example is settings: `/settings?section=…` became `/settings/<section>`, and `frontend/app/(pages)/(private)/settings/page.tsx` still answers the old form.

## How

- Order: `git grep` every literal of the old path (links, `router.push`, `href=`, nav `matchers`, breadcrumb entries, tests) → move the page → turn the old address into a redirect → update tests last, so they check the finished move and not a half-way state.
- Always keep the old URL as a redirect: bookmarks, shared links and links on other screens outlive the change. The settings index maps legacy names with `sectionFromLegacyName` and forwards with `router.replace(settingsSectionHref(...))`; `replace`, so the dead address does not stay in history.
- Spell the address in one place. `frontend/app/utils/settingsSections.ts` is read by the route, the nav highlight and every incoming link, so a section cannot be spelled one way in a link and another in the router.
- Move the navigation with it: `matchers` in `frontend/app/components/navigation/navConfig.ts` and the labels in `Breadcrumbs.tsx`.

## Replacing a placeholder `/new` route

- A placeholder route shows an unsaved entity under a fake id and swaps to the real id after create. `/studies/new` is one today: `studies/[id]/page.tsx` treats `noteId === 'new'` specially, and the dashboard and the studies list link to it.
- To replace one, every hardcoded shortcut calls the create mutation itself with the same empty defaults (one canonical empty payload, not one per button) and routes to the real id. Then `git grep` the old `/new` link until the count is zero.
- Leave removal of the legacy placeholder handling to the change that owns that screen; do not fold it into the shortcut change.

## Why

- 2026-02-26: the sermon list moved from `/dashboard` to `/sermons`; the order above comes from that move. `/dashboard` has since become an overview page of its own, so that redirect no longer exists.
- 2026-05-22: `/new` placeholders were replaced by direct create shortcuts; the canonical-empty-payload and grep-to-zero rules come from that change.

See also: `.howto/add-a-page-to-navigation.md` · `.howto/navigate-after-create.md`
