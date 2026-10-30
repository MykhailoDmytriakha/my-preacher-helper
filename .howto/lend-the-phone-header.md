when: a page's controls in the app header on a phone · one header instead of two · page header in the shell · header folds while reading · header collapses on scroll · slim header · шапка складывается · одна шапка · шапка читалки в шапке приложения · Отзыв в меню · the header folded on arrival · the header opened by itself · useShellHeader · shellHeader · PhoneHeader

# Lend a page's controls to the phone's app header

On a phone the Bible reader has one header: its way back, place, trail and search stand in the app's own header, with «Меню» on the right as on every screen (the owner, canvas v74, 2026-10-26). Any page can do the same through `frontend/app/components/navigation/shellHeader.tsx`, modelled on `shellTitles.tsx`.

## How

- **Publish:** `useShellHeader(content, compact)` from the page, only while it wants the phone header (the reader: below 768 px, once the text is there). `compact` is what the folded line shows — the place. `null` gives the header back.
- **What the shell does then** (`DashboardNav.tsx`, below `lg` only): the row is [the page's content][the indicators][«Меню»]; «Отзыв» moves to the first item of `MobileMenu`. The row has one state word, `PhoneRow`: `own`, `open`, `folded`.
- **Folding:** `useShellHeaderCollapse` folds the row to 36 px when the person reads down past 80 px and opens it when they scroll up, keeping the words under the eyes where they were (the scroll moves by the height's change).
- **The page's own moves:** a page that scrolls the window itself tells the shell after the move, and only when the window did move: `useShellHeaderPageMoved()`. The reader does it through `readingSurface(pane, pageMoved)` and in `jumpTo`.
- **A jump shows the header whole:** `useRevealShellHeader()`, called by the reader's `jumpTo`. The header opens without keeping the scroll, so the verse jumped to stands under the whole header.

## Traps

- A scroll of the window is not the person reading. The reader's jump to a verse folded the header on arrival and hid the way back (live, 2026-10-26). A scroll counts only after a finger, a wheel or a key (`PERSON_SCROLL_MS`), and a move the page told of never counts, even under the finger: the chapter window keeps its place while the person reads.
- Tell a page move after it, not before: a move to where the window stands sends no scroll event, and a word said before waited and swallowed the person's next scroll.
- Test a fold with `fireEvent.touchMove(window)` before the scroll, as `__tests__/components/navigation/DashboardNav.readerHeader.test.tsx` does; a bare scroll event is the page's own now.
- Check it live with a real finger, not `window.scrollTo`: Playwright with `isMobile`/`hasTouch` and Chrome's `Input.synthesizeScrollGesture` (`gestureSourceType: 'touch'`) through a CDP session. Arrive by a link, read down, scroll up, follow a verse's link while folded.

See also: `.howto/show-the-place-trail.md` · `.howto/open-a-modal.md` · `.howto/emulate-phone-layout.md`
