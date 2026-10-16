when: iPad · finger keeps scrolling the other pane · touch taken by the page · momentum · inertia · fling · coasting · nested scroller · sidebar does not scroll until the page stops · minimap scrolls the text · touchstart not fired during momentum · touch-action none does not help · data-reader-panes · data-study-workspace · readingSurface · палец крутит не ту панель · инерция · по инерции · страница ещё катится · вложенная прокрутка · боковая панель не листается · карта крутит текст · дождаться, когда текст остановится

# Keep a pane scrolling under a finger on an iPad

On an iPad a page coasting under its own momentum takes a finger put on any scroller nested inside it: the nested pane does nothing until the page stops. No script can fix that — iOS stops the coast but sends the page no `touchstart`/`touchmove` for that finger (developer.apple.com/forums/thread/99316), and WebKit's momentum behaviour differs between versions (bugs.webkit.org/show_bug.cgi?id=187449). The fix is structural: where two panes must scroll on their own, the page itself does not scroll, and the panes are siblings, not parent and child.

## How

- Bound the shell to one screen and let the panes scroll: `#app-shell:has(<marker>)` gets `height: 100dvh; overflow: hidden`, the page root and `main` become flex columns with `min-height: 0` (`frontend/app/globals.css`).
- Two markers exist. Studies: `data-study-workspace`, set by route in `PrivateChrome` (`frontend/app/components/PrivateWorkspace.tsx`), CSS under `@media (min-width: 1024px)`. The Bible reader: `data-reader-panes`, set by the reader itself while the minimap shows (`wide`), so its CSS has no media query.
- Code that read the page's scroll must read the pane's on wide screens. The reader does it through one description, `frontend/app/components/bible/readingSurface.ts` (`top`, `scrollTo`, `height`, `contentHeight`, `edge`, `bottom`, `target` for scroll events): the page on a phone, the text's pane beside the minimap. Its jumps (`scrollIntoView` with `scroll-margin-top: var(--reading-top)`, which becomes the gap inside the pane), the room under the book, the place it keeps and the minimap all use it.
- Draw the pane before the content arrives: the first jump and every measurement must see the pane, not the page.
- Make the pane focusable (`tabIndex={0}`): with the page standing still, PageDown and Space scroll only a focused pane.
- Page gestures (`frontend/app/components/navigation/gestures/touchTargets.ts`): a pane that scrolls only up and down keeps the pull for itself (`NESTED_UP_AND_DOWN`), but a swipe across it is still the way back; a pane that scrolls sideways keeps every swipe.
- Prove it with the finger on a real iPad: desktop wheels and Chrome touch emulation do not produce the coast.

## Why

- 2026-09-05: studies — the outline panel did not scroll until the text stopped (BUG-20260905-ipad-study-scroll-handoff, `.sessions/SESSION_2026-09-05-ipad-study-scroll.md`). Fixed with sibling panes; script workarounds rejected.
- 2026-10-16: the Bible reader — a flick of the text, then a finger on the minimap went on scrolling the text (BUG-20261016-ipad-minimap-finger-taken-by-coasting-text, commit 41ad8e64). The owner remembered the first case; there was no recipe, and it was found by reading old session notes. Same fix, plus `readingSurface.ts` and the swipe-back rule so the text in a pane still goes back.

See also: `.howto/style-scrollbar-and-native-controls.md` · `.howto/debug-on-ipad.md`
