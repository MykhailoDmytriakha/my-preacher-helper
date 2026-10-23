when: check a Design canvas board · board fine locally, broken on the canvas · numbers do not fit the tiles · dc-runtime.js · support.js · .dc.html · Play does nothing · проверить доску холста · на доске цифры вылезли · на холсте не работает · доска Design

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

## Traps

- **A hand-made preview lies.** Template plus own renderer, as in round 7 of 5.3 and the first round of 5.2. On 2026-10-23 it showed every tile fitting, while the owner saw the verse numbers 100–176 of Ps 118 spill out of their tiles.
- **A button keeps the browser's own padding.** The app's Tailwind preflight removes it; a board does not. Give tile buttons `padding: 0`.
- **The Chrome extension cannot drive a board.** The canvas renders it in a frame on another domain, so clicks never arrive. The canvas's own runtime, run here, replaces the extension.
- **Play reaches every button.** A button the owner can press and that does nothing reads as broken — «Все книги» on the 5.2 boards did. Wire it, or leave it out of the board.

## Why

- 2026-10-23, case 2026-10-12-block-diagram, 5.2: the owner's word «местами цифры не вместились, что-то не подрабатывало» after boards checked only with a hand-made preview.
