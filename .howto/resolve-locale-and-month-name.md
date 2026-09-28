when: interface language · which language is the interface in · app locale · i18n.language is ru-RU · resolveAppLocale · useAppLocale · dateFnsLocaleFor · date-fns locale · month name · month heading declined · month name in genitive · month as a heading · MMMM vs LLLL · formatMonthTitle · formatMonthName · detectTextLocale · language of a piece of text · язык интерфейса · локаль · название месяца · месяц в родительном падеже · склонение месяца · формат даты · язык текста

# Resolve the interface language and name a month

The interface language and the date language come from `frontend/app/utils/appLocale.ts`; a component reads both through `useAppLocale()` → `{ locale, dateLocale }` (`frontend/app/hooks/useAppLocale.ts`).

## How

- `resolveAppLocale(language)` is the only place that turns `ru-RU`, `uk-UA`, an empty string or anything else into `'en' | 'ru' | 'uk'`; unknown reads as English, the language every string has. Bible book names (`resolveBibleLocale` delegates to it), Scripture references and month names all hang off this one decision — never write another "starts with ru" check.
- `dateFnsLocaleFor(language)` gives the date-fns locale for month and weekday names.
- A month standing alone — heading, bar label, window title: `formatMonthTitle(date, dateLocale)`, the standalone `LLLL yyyy` form, capitalized. In Russian and Ukrainian `MMMM` is the form a month takes inside a date (genitive, "the 20th of September"); as a heading it prints the declined form.
- A month inside a sentence: `formatMonthName(date, dateLocale)` — the same standalone form in lower case. Russian and Ukrainian templates put it after the preposition meaning "for", never after the one meaning "in": that needs the prepositional case, which date-fns does not have.
- Text that reaches a reader without the interface around it (a link preview card, a reference inside dictated prose): `detectTextLocale(text)` reads the letters — Ukrainian-only letters mean uk, any other Cyrillic ru, everything else en.

## Traps

- `StepByStepWizard.tsx` still derives the language by hand (`i18n.language.split('-')`) to pick voice sample files. It agrees today; route it through `resolveAppLocale` when you touch it.

## Why

- Five components worked out the language by hand and six calendar components kept their own date-locale switch; they agreed only because nobody had changed one yet. Four calendar places wrote `MMMM` and printed a declined month as a heading — English has one form, so it never showed there.

See also: `.howto/work-with-the-calendar.md` · `.howto/format-scripture-reference.md` · `.howto/add-translation-key.md`
