when: Scripture reference · Bible reference · print a reference · format a verse · book abbreviation · Luke 5:17-26 · formatScriptureReference · formatScriptureReferences · scriptureReferenceSearchText · canonical English book name · book names in prompts · Psalm numbering · Septuagint · Hebrew numbering · psalm number off by one · search notes by reference · Bible reference parser · parseReferenceText · referenceParser · dictated reference · spoken chapter and verse · normalizeSpokenScriptureReferences · extractBookIdsFromVerse · ordinary word taken for a book · ссылка на Писание · библейская ссылка · стих · название книги · сокращение книги · нумерация псалмов · поиск по ссылке · разбор ссылки · продиктованная ссылка · слово принято за книгу

# Print, search or parse a Scripture reference

Print a reference through `formatScriptureReference(ref, { style, locale })` in `frontend/app/utils/scriptureReference.ts`; parse typed text with `parseReferenceText(raw, locale)` in `frontend/app/(pages)/(private)/studies/referenceParser.ts`. Never build `book chapter:verse` by hand.

## How

- One reading of the shape, three faces. `short`: the book abbreviated in the interface language and glued to the chapter — chips, compact labels. `long`: the full localized book name — cards, previews. `canonical`: the stored English name and stored numbering ("Luke 5:17-26") — AI prompts and machine comparison only, never shown as the interface's words.
- Psalms are stored in Hebrew numbering. `short` and `long` renumber them to the Septuagint for ru and uk (`psalmHebrewToSeptuagint`); `canonical` never does. The parser converts back on input, so pass it the locale. `short` without a locale falls back to the Russian abbreviation table.
- A verse wins over a leftover chapter range (old data carries both); `5:17-17` prints as one verse.
- Several references: `formatScriptureReferences(refs, { ...face, limit, separator })` returns `undefined` when there is nothing, so callers write `?? fallback`.
- Search: `scriptureReferenceSearchText(ref, locale)` — the short and long forms lowercased, psalms numbered as displayed — so a reference read off a card finds that card.
- AI prompts ask for book names in English (`frontend/app/api/clients/studyNote.structured.ts`): the stored `book` is the canonical English id the parser and the book table key on.
- Dictated references ("Deuteronomy 10 chapter 11 verse"): prompt wording alone does not hold. `normalizeSpokenScriptureReferences` (`frontend/app/utils/scriptureReferenceNormalizer.ts`) is a deterministic pass after the model that reuses `parseReferenceText` and writes the citation form; it runs on polish and thought outputs (`polishTranscription.structured.ts`, `thought.structured.ts`) and is tested in `frontend/__tests__/utils/scriptureReferenceNormalizer.test.ts` and both client tests. Speech goes the other way: `normalizeScriptureReferencesForTts`.
- Finding books inside free text (`extractBookIdsFromVerse` in `frontend/app/components/calendar/calendarAnalytics.ts`): a fuzzy prefix match only for 2–4-character tokens (`isFuzzyAbbrevMatch`), longer words must share at least 5 leading characters (`isPrefixInflectionMatch`), and a hit counts only when a number or a chapter/verse word follows — or the text is the book alone. Otherwise ordinary words become books.

## Traps

- Three note searches still build reference text by hand instead of `scriptureReferenceSearchText`: the `filteredNotes` filter in `studies/page.tsx` (it runs before `matchesSearchTokens`, so it can drop a note the card-based match would find), `useFilteredNotes` in `studies/[id]/page.tsx`, and the search in `frontend/app/services/studies.service.ts` (English names). None of them knows the abbreviation or the psalm renumbering.
- `parseReferenceText` accepts a prefix of any length of an English book id and a book with no chapter. Right for the picker where a person types a reference; wrong for scanning prose — use the free-text rules above.

## Why

- 2026-09-16: eight builders were collapsed into this one; the calendar had borrowed a raw English one and printed "Luke 5:17-26" under a note whose own chips showed the Russian abbreviation.
- 2026-04-25: prompt wording alone did not turn dictated references into citation notation; a deterministic pass did.
- 2026-02-02: fuzzy prefix matching on long tokens and on text without a chapter number produced false book matches.

See also: `.howto/resolve-locale-and-month-name.md` · `.howto/work-with-the-calendar.md`
