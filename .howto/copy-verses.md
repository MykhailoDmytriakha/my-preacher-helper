when: copy a verse · share a verse · verse menu · hold a verse · several verses · select verses · copy with the reference · clean copy · Cmd+C in the Bible · verseCopyText · useVerseCopy · копировать стих · отправить стих · меню стиха · выбрать несколько стихов · скопировать со ссылкой · номера в копии

# Copy or send verses from the Bible

A verse leaves the reader as text made from the verses themselves — never from what the page draws around them (numbers, link chips, badges). The text is one pure module, `frontend/app/utils/verseCopy.ts`; the reader's ways to take verses live in `frontend/app/components/bible/verseCopy/`.

## How

- The text: `verseCopyText(verses, format, names, chapterLength?)` — the place FIRST, then the words, as a verse is cited in a sermon. One verse (or a quote of several) goes as `Ис 47:4: "Искупитель наш — Господь Саваоф имя Ему, Святый Израилев."` — straight double quotes in every language, the quotation marks inside a verse left as they are; several verses numbered (`defaultCopyFormat`) go as the place and a colon on the first line, then `28 words` per verse (`Рим 8:28–30:`). A quote that starts with a small letter opens with «…», one that ends at a comma, a semicolon, a colon or a letter ends with «…»; a piece of a verse says on which side it was cut. Gaps between verses are «…». `chapterLength` lets 8:39 and 9:1 follow each other with no gap.
- The names: `useCopyNames(bible, bookId)` gives `{ book, mark? }`. The BOOK is the Bible's, not the interface's — shortened in the Bible's language: copied Synodal text carries «Рим», whatever the interface speaks. The Bible is named ONLY when it is not the Bible of the interface's language (`bibleForLocale(resolveAppLocale(i18n.language))`): then `mark` is its short name in the interface's language (`bible.translations.<id>.short` — «Синод.», «Огиенко», «KJV») and the place reads `Isa 47:4 (KJV): "…"`. Same rule as every reference mark (`format-scripture-reference.md`, "The mark"); the Synodal verse in a Russian interface carries no mark, in an English one `Ис 47:4 (Synodal): "…"`.
- In the reader (`useVerseCopy`, `VerseHoldSurface`, `VerseMenu`, `VerseCopyBar`): a verse held (the app's one hold, `useLongPress`) or pressed with a computer's right button opens its menu — Copy · Send (where `navigator.share` exists) · Choose several · Links. «Choose several» turns presses into choosing; a hold or Shift+click chooses a passage; the bar copies or sends them. A selection copied by the system (⌘C) inside the text is rewritten clean with the place (`selectedVerses`).
- The links window copies its verse with a sign after the verse's words (`CrossReferenceSheet`, `useClipboard`).
- The chosen and held verses are lit by attributes on the rows (`data-verse-chosen`, `data-verse-held`, set by `useVerseCopy`, styled in `BookRibbon`'s `CHOSEN_CLASSES`), like the arrival: the ribbon is not drawn again for a choice, and the lights are set again when the chapter window brings rows back.

## Traps

- Right button over selected text is the browser's: its own menu (copy, look up, translate) stays.
- A mark tool in hand paints: `marks.toolInHand` turns the hold and the menu off.
- A field being typed in keeps its own selection apart from the page's (Firefox): the clean copy leaves a copy alone when a field has the focus.
- On a touch screen the reader's words are not selectable (`[@media(hover:none)]:select-none`): a finger's hold is the verse menu. A part of a verse is copied by a mouse's selection only (the owner's choice, 2026-10-27).
- `navigator.share` must be called in the press itself, with nothing awaited before it.

## Why

- 2026-10-27, the owner (case 2026-10-12-block-diagram, 4.7; canvas board «Копировать стих», v78): a verse is copied to make a sermon of it, to send it as a wish, or to take a few verses while preparing; «нажал и удержал — выпадает контекстное меню, красивое»; the number and ⇄ keep opening the links window, which got the copy sign.
- 2026-10-27, the owner, the shape of the copy: «Ис 47:4: "Искупитель наш — Господь Саваоф имя Ему, Святый Израилев." Сначала ссылка, потом стих. И не указывается, что синодальный перевод, если он совпадает с локализацией. Если не совпадает — подписываются (King James, KJV, Огієнко).» Replaced the first shape (`«words»` and `— Рим 8:28 (Синодальный перевод)` under it, the Bible's full name and its language's quotation marks).
