when: live check · живая проверка · проверить живьём · playwright script against the dev server · a live script changes data · EPIPE killed the script · | head cut the run · browser closed before the save · data left behind after a check · связь осталась в базе · test user · тестовый пользователь · the dev server writes to production · Войти как тестовый пользователь · lang=ru cookie

# Run a live check that changes data

A live check drives the real app on `next dev` (:3000) with Playwright and the dev-only button «Войти как тестовый пользователь» (`frontend/app/(pages)/page.tsx`, the existing account `testuser@example.com`). The dev server writes to the PRODUCTION Firestore, so whatever the script changes is real data of that account: the script leaves it as it found it.

## How

- **Output to a file, never through `| head` / `| tail`.** A closed pipe kills node with EPIPE in the middle of the run — after a change, before its undo (2026-10-29: a link stayed in the test user's analysis). `node live-x.cjs shots > out.txt 2>&1; cat out.txt`.
- **The script undoes its own changes in the same run and ends with `say('Готово')`.** No «Готово» in the output means it stopped early: look at what it left.
- **Wait for the save before closing the browser** — at least 2.5 s after the last change, or until the screen says it is kept. Closing right after «Отменить» lost the undo (2026-10-29).
- **A fresh browser starts in English**: add the cookie `lang=ru` before the first page (`reference_fresh_probe_starts_english`), and pick places by their buttons, not by text that depends on the Bible's language.
- **Select by role and name, as a person sees it** (`getByRole('button', { name: 'Готово', exact: true })`); a test id only where nothing visible names the thing. A screen redesigned the same day breaks a script that clicked an old row — update the script, not the screen (the analysis badge's window lost its row «Разбор · место» on 30.10; scripts open the analysis by «Открыть разбор …»).
- **Count, then look**: print the numbers that prove the outcome (flags, lines, arrows, the address) and take a screenshot to look at — a count says it happened, the picture says it looks right.
- **Close what you started**: the browser at the end of the script; the dev server at the end of the work unless the owner is trying the change on it (`fix-stuck-dev-server.md`).

## Examples

`.cases/2026-10-12-block-diagram/demo-analysis/live-batch.cjs` — the analysis's address, reload, five quick colour picks, ⌘Z and the badge window on the test user's Eph 1:1–2, every change undone; `live-untangle.cjs` — four links drawn, «Все связи» shot, the links removed.
