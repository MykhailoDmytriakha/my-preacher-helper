when: check a Design canvas board · board fine locally, broken on the canvas · numbers do not fit the tiles · dc-runtime.js · support.js · .dc.html · Play does nothing · setState stale · state comes back · проверить доску холста · на доске цифры вылезли · на холсте не работает · доска Design · выбор не снимается · board does not look like the app · canvas не похож на приложение · real screenshots · снимки живого приложения · inject into the live page

# Check a Design canvas board

A board on the owner's Design canvas (claude.ai, files `project/*.dc.html`) is checked with the canvas's own runtime, run on this machine. Neither a hand-made preview nor the Chrome extension shows what the owner sees.

## How

1. Fetch the runtime once: `Artifact` action `read`, `path: "artifact-type/dc-runtime.js"`. It is one self-contained file with React inside.
2. Put the boards in a scratch folder, with `dc-runtime.js` saved there as `support.js`: every board loads `./support.js`.
3. Serve the folder with `python3 -m http.server <free port> --bind 127.0.0.1` and open each board in Playwright.
   - `<dc-import>`, `sc-for`, `sc-if` and events work as on the canvas.
   - The viewport is the board's `$preview` size.
4. Two scripts do this in `.cases/2026-10-12-block-diagram/demo-verse/`:
   - `realrt-shoot.cjs <folder> <port>` takes a screenshot of every board and lists the buttons whose text is wider than the button;
   - `choice-play.cjs` walks a board by hand and lists errors.
5. Stop the server by its own task, not by pattern.

## A board of an existing screen

A change to a screen the app already has is shown on that screen, not redrawn: a hand-drawn copy invents what the app does not have, and the owner rejects the whole canvas (v69, 30.10).

1. Shoot the real app on localhost with the test user at 1440×900 (`.cases/2026-10-12-block-diagram/demo-sermon/shoot-real.cjs`, `shoot-real2.cjs`).
2. Put only the new element into the live page for the shot (`insertAdjacentHTML`), in inline styles with the app's own tokens — a Tailwind class the bundle never compiled draws nothing. Measure its box with `getBoundingClientRect` into a JSON file.
3. Change a shown text through text nodes (`TreeWalker`), never by replacing an element's HTML: «the last div» was the page's root and wiped the whole page. Change only what the app itself would show otherwise — the title, the passage, the date — and read the component first: the reading of the preparation's step 1 looked like the sermon's text, but it is a fixed passage for the preacher (`wizard.steps.spiritual.passage`); set to the sermon's verses, the board showed an app that does not exist.
4. The board: each state a shot (JPEG data URI), and transparent buttons over the measured boxes, the next step pulsing (`build_case1.py`).
5. Save nothing: a dialog with typed fields answers «Отмена» with «Отбросить изменения?» — press «Отбросить», count the list before and after. Shoot a page in a fresh browser: a draft left in the same browser shows as a recovery banner on the next page.
6. Log in waiting for the address only: `waitForURL(/dashboard/, { waitUntil: 'commit' })` — the dashboard's «load» did not come within two minutes.

## Traps

- **A hand-made preview lies.** Template plus own renderer, as in round 7 of 5.3 and the first round of 5.2. On 2026-10-23 it showed every tile fitting, while the owner saw the verse numbers 100–176 of Ps 118 spill out of their tiles.
- **A button keeps the browser's own padding.** The app's Tailwind preflight removes it; a board does not. Give tile buttons `padding: 0`.
- **The Chrome extension cannot drive a board.** The canvas renders it in a frame on another domain, so clicks never arrive. The canvas's own runtime, run here, replaces the extension.
- **Play reaches every button.** A button the owner can press and that does nothing reads as broken — «Все книги» on the 5.2 boards did. Wire it, or leave it out of the board.
- **Two `setState` in one press read a stale state.** `DCLogic.setState` is not applied at once: a second change that merges into `this.state` (copy, then its passing words) brings back what the first one removed. On 2026-10-27 the verses stayed chosen after «Копировать». Keep a frame's state in a module-level store, merge every change into it, and pass the store to `setState` (`demo-copy-verses/build2.py`, `store`).
- **Playwright scrolls inner panes to what it presses.** A click inside a scrolling window moved the window's own scroll by 78 px, and the screenshot showed its title gone. Read the pane's `scrollTop` before the press and set it back before the shot; never take that shot as the board's look (`play2.cjs`).

## Why

- 2026-10-23, case 2026-10-12-block-diagram, 5.2: the owner's word «местами цифры не вместились, что-то не подрабатывало» after boards checked only with a hand-made preview.
