when: translation · i18n · add a translation key · new text on screen · t('…') shows the key · raw key on screen · translation missing in ru/uk · locales · translation.json · useTranslation · plural · _one _few _many _other · count · ICU plural · duplicate key in translation.json · translation silently overwritten · defaultValue · export text language · locale parity test · translationKeyCoverage · translationOrder · common.saved · перевод · ключ локали · новый текст на экране · ключ вместо текста · нет перевода на русский · множественное число · склонение по числу · дубль ключа · три локали

# Add a translation key

Every new `t('key')` goes into all three files frontend/locales/{en,ru,uk}/translation.json in the same change and the same commit — grep the key first. i18next with `useTranslation`; the resources are bundled in `frontend/locales/i18n.ts`.

## How

- `frontend/locales/__tests__/translationKeyCoverage.test.ts` scans literal `t('a.b')` calls and fails when en, ru or uk lacks the key. It sees literal keys only: a key held in a variable, a constant or a fallback map is invisible to it — check those by hand.
- Insert the key at the same place in all three files: `frontend/locales/__tests__/translationOrder.test.ts` requires the same key order.
- Plurals use suffix keys, never ICU `{count, plural, …}` syntax. English needs `_one` and `_other`; Russian and Ukrainian need `_one`, `_few`, `_many` and `_other` (their plural categories). Call `t('key', { count })`.
- `defaultValue` is an emergency fallback, never the translation.
- A shared status word such as "Saved": reuse the long-lived common key (`common.saved`) instead of a feature-scoped one when the text is the same — fewer keys, and a client still running an older bundle already knows it.
- Duplicate keys are not an error anywhere: webpack's JSON parser, Jest and `tsc` all keep the last value silently and the first translation is lost (checked 2026-09-27). Look at the whole parent object before adding.
- Export screens and the exported document text go through i18n as well — `frontend/app/utils/exportContent.ts` calls `i18n.t(key, 'English fallback')`, so tests without resources still read. A date inside an export uses the app locale, never a hard-coded language.
- Promoting a page to a default route: add a full en/ru/uk parity test in the same change, like the `dashboardHome` test in `frontend/__tests__/locales/translationKeyCoverage.test.ts` (`collectLeafPaths` compares leaf paths). Without it the page silently ships English-only sample copy.

## Why

- 2026-02-23: duplicate keys were recorded as a webpack parse error; the build actually accepts them and drops the earlier value without a word, which is why uniqueness is on you.
- 2026-02-28: shared status labels moved to common keys to cut raw-key leakage on clients with stale locale caches.
- 2026-02-01: export UI and document text moved under i18n, with fallbacks so tests still read.
- 2026-04-28: promoting a prototype dashboard to the default page nearly shipped its static English sample copy.

See also: `.howto/resolve-locale-and-month-name.md`
