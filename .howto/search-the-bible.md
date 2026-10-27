When: search the Bible · find a verse by its words · search button in the reader · show more results · first 40 of · поиск в читалке · показать ещё · word not finished · beginning of a word · недописанное слово · по началу слова · bible search line · search in a book · search in a chapter · search in the New Testament · word forms · wildcard * _ · exact phrase · search history · how to search help · поиск по Библии · найти стих по словам · строка Библии · где + что · Иоанна хлеб · формы слова · звёздочка · подчёркивание · история поиска · как искать · readLine · readSearch · BibleSearch · book by first letters · dictated book name · иса 3416 · Исаии 34 16 · падеж книги · bookBeforePlace

# Search the Bible with the one line

The line on the Bible page and in the reader's book window reads «где + что»: a place to open, or words to find with where to look written first (the owner, canvas v58, 2026-10-23).

It has three doors, one component (`BibleSearch`):
- the Bible page: the line at the top, the books under it;
- the reader's book window (the book's name): the line over the books — it always opens empty, it is the way to a book;
- the reader's search (`SearchPicker` in `BiblePicker.tsx`): «Поиск» in the book's line, and on a phone a round magnifier in the bar under the thumb. It opens empty with the searches kept under it (`openWithRecent`), or «Как искать» when there are none. A search chosen there comes back on the verse last opened from it (`lastSearch.ts`).

## Where it lives

- `frontend/app/utils/bibleSearch/` is the rule, pure and tested:
  - `query.ts` decides what a line means — `readLine` → a place, a book, digits run together, a bad chapter or verse, or a search with its scope. Places go through the app's reader of references (`referenceFromText`); never parse references again.
  - `wordForms.ts` matches word forms by endings, plus the vowel that comes and goes. A word with `*` or `_` is taken as written; a two-letter word too.
  - `searchIndex.ts` holds the vocabulary once and each verse as numbers. `searchIndexStore.ts` loads the saved books first (`keptBookText`), then the network.
  - `results.ts` gives the hits in scope, the forms found and the wider steps with their counts. A word the Bible has in no form is searched as the beginning of a word (`matchersIn`): the line is read at every keystroke, so «НЗ оде» finds «одежда» before it is finished, the head says «Слова на «оде»», and «одежд» is back to its forms. A word the Bible has keeps to its forms («мир» is not «мирра»).
- `frontend/app/components/bible/search/` is the screen:
  - `searchModel.ts` is a pure description of what to show for a reading. Change states there, not in the JSX.
  - `BibleSearch.tsx` holds the state and the keys.
  - `searchHistoryStore.ts` is device-only, like the trail of places.

## How

- **A new way of writing a scope** (a part of the Bible, a spoken form): add it to `PART_WORDS` or `BEFORE_BOOK` in `query.ts`, with a case in `__tests__/utils/bibleSearch/query.test.ts`.
- **A book written loosely before a place** («иса 3416», dictated «Исаии 34 16», «Иеремии 29 11»): `bookBeforePlace` in `query.ts` reads it when the exact name fails. The word must begin, or be a form (`matcherOf`) of, the word that calls exactly one book (`CALLING_WORDS`: the name's first word without «от/к/до/від», the number apart), and only the place's numbers may follow. The book suggestions under the line (`booksBeginningWith`) accept the same form. Never add aliases to the book data for this: the list is never complete (BUG-20261026-search-book-prefix-place).
- **More results:** forty at a time (`SHOWN_VERSES`); the last option «Показать ещё N» adds the next forty and puts the arrows on the first of them. Another line starts from forty again.
- **A new state under the line:** add it to `buildSearchModel` and a sequence to `__tests__/components/bible/bibleSearch.test.tsx`. The test runs over the real texts in `public/bible-text`.
- **The texts the help shows:**
  - `bible.search.*` lives in all three locales.
  - Examples are keyed by Bible (`bible.search.examples.<rst|ubio|kjv>`), because they must exist in that Bible's text.
  - Check each example with the engine before writing it.
- **Counts are real:** `__tests__/utils/bibleSearch/searchIndex.test.ts` pins them (for example «Иоанна хлеб» 21, «НЗ благодать» 120). A changed count means the matching rule changed.

## Traps

- Mark the found words with `answer.matchers`, not `matchersOf(query)`: a word read as a beginning is searched by another matcher than the one typed.
- On the Bible page the line, its panel, the trail and the Testaments share the page's two edges (the owner, 2026-10-23: three right edges looked unaligned). The verse text keeps a reading measure inside the full-width panel (`max-w-[46rem]`).
- Ohienko prints stress marks («Па́стир»): `normalizeWord` drops U+0300/U+0301 only. Never NFD-decompose, or «й» and «ї» break.
- «The same search line» is one rule, `keptLine` (`utils/bibleSearch/words.ts`: no spaces at the ends, one between words), for the history, the verses opened from a line («Открывали», `lastSearch.ts`) and «Показать ещё». A place that compares lines its own way loses the way back: Codex found three such ways in a row (2026-10-23).
- Never bring the last search back into a line unasked: the owner cleared it and it came back on the next opening (2026-10-23). The way back to results is the history.
- Enter must read the line as typed now: the rows may still be of a shorter line («Пс 2» for «Пс 22», `useDeferredValue`).
- Keys belong to the panel in sight. Escape is handled on the whole line, so a focused result button does not let it close the picker window.
- Widening to the whole Bible writes the words «as words» when they would read as a book («Мф плач» → «плач»).
- Compare a loose word with the word that calls the book, not with every word of its name: «Иеремии» is also the second word of «Плач Иеремии», and with all words «иеремии 29 11» was two books and stayed a search, while «закона 5» opened Deuteronomy through «Повторення Закону». A scope before words («Рим 4 вера») stays exact on purpose: a wrong guess there narrows the search silently.
- Never say «nowhere in the Bible» while some books did not load. The model's coverage says saved or loaded.
- `__tests__/architecture/interfaceTextGoesThroughLocales.test.ts` allows Cyrillic in `utils/bibleSearch` as parser vocabulary. User-facing words still go to the locales.

See also: `.howto/format-scripture-reference.md` · `.howto/show-the-place-trail.md` · `.howto/add-a-bible-translation.md`
