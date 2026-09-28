when: two copies of one rule · consolidate duplicates · copies disagree · duplicated helper · second implementation of a shared rule · Canonical Mechanisms · move the rule into one module · partial jest.mock breaks after a new export · is not a function · jest.requireActual · test stub calls onDelete on every render · suite hangs on confirm · @/../../frontend/locales · @locales/ · дубликат правила · две копии одного правила · свести в один модуль · копии расходятся · вторая реализация общего правила · общий механизм · частичный мок ломается после нового экспорта

# Consolidate a duplicated rule

Before writing a rule, find the one that already exists: the recipe of that operation in `.howto/`, then the code it names. When copies already exist, move the rule into its module UNCHANGED, prove a test goes red on the behaviour, and only then change the behaviour. The work is finished when the old copies are gone and each shared rule has a guard that turns red when the rule is switched off.

## How

- Move first, change second. Extract the rule verbatim into its shared module, point every caller at it, run the tests. Then write the behaviour test, watch it go red with the rule switched off, and only then change the behaviour.
- Delete every old copy in the same change and grep the old names to zero. Anything less just adds one more copy.
- Every partial `jest.mock` of the shared module keeps `...jest.requireActual(...)`; without it the mock breaks the moment the module grows an export (`scriptureReferenceSearchText is not a function`).
- A test stub fires a handler once, like a click. With an awaited in-app confirm (`useConfirm`), a stub that calls `onDelete` on every render asks for ever and hangs the suite.
- Import shared files through aliases (`@locales/...`). A path written as `@/../../frontend/locales/...` resolves only inside a folder named `frontend`, and broke in an isolated copy.
- Run the production build gate in an isolated copy of the tracked files with `node_modules` symlinked, never into the `.next` of a running `next dev`.
- Where the five consolidated rules live now: `resolveAppLocale` (`frontend/app/utils/appLocale.ts`), `formatScriptureReference` and `scriptureReferenceSearchText` (`frontend/app/utils/scriptureReference.ts`), `isBrowserOffline` (`frontend/app/utils/connectivity.ts`), `readOwnerList` (`frontend/app/services/ownerListRead.client.ts`), `useConfirm` (`frontend/app/hooks/useConfirm.tsx`).

## Why

- 2026-09-16: interface language, Scripture references, the offline check, the owner-read helpers and the "are you sure?" question lived as copies that disagreed quietly: the calendar printed an English reference beside the note's short local form, two note searches matched different text, and four month headings used the in-a-date month form.

See also: `.howto/mock-in-jest.md` · `.howto/ask-are-you-sure.md` · `.howto/format-scripture-reference.md` · `.howto/resolve-locale-and-month-name.md` · `.howto/read-owner-documents.md` · `.howto/fix-stuck-dev-server.md`
