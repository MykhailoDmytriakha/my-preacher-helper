when: live check · живая проверка · проверить живьём · playwright script against the dev server · a live script changes data · EPIPE killed the script · | head cut the run · browser closed before the save · data left behind after a check · связь осталась в базе · test user · тестовый пользователь · the dev server writes to production · Войти как тестовый пользователь · lang=ru cookie

# Run a live check that changes data

An agent's live data check drives the real app on a dedicated local server connected to isolated Firestore and Auth emulators. Follow [Run a demo on the emulator](run-a-demo-on-the-emulator.md) for setup, canonical seed commands and owned-hub export. Confirm the actual browser SDK emulator port and Admin SDK host before opening data views; keep `NEXT_PUBLIC_API_BASE` empty. A production-built stand must compile the public emulator settings before `next start`. Use an owned synthetic test identity and deny production database traffic. Select the linked recipe's separate Auth-emulator procedure beginning “For an admin-only outage stand”; its introductory real-sign-in setup alone does not supply the Auth isolation required here. Require `FIREBASE_AUTH_EMULATOR_HOST` on the scoped server and actual local Auth SDK/lookup evidence. If the serialized browser session asks `accounts:lookup` at the compiled cloud origin, forward only that exact, owner/audience-checked request to the owned Auth emulator and use its real response, as that procedure describes; deny cloud Auth delivery. The ordinary manual server can use production credentials, so localhost alone does not establish isolation. The owner left the general launch-default choice open; this recipe changes no shared launcher or manual-server configuration.

## How

- **Output to a file, never through `| head` / `| tail`.** A closed pipe kills node with EPIPE in the middle of the run — after a change, before its undo (2026-10-29: a link stayed in the test user's analysis). `node live-x.cjs shots > out.txt 2>&1; cat out.txt`.
- **The script cleans up its exact own fixture in the same run and records completion.** Guard cleanup by owner, original generation and expected content; verify the canonical result. If create delivery is unknown, establish that the record belongs to the original operation before deleting or replaying anything. A missing completion marker means the run stopped early: inspect its retained diagnostics and exact fixture.
- **Wait for acknowledged saving before closing the browser.** Require the actual command acknowledgement and canonical readback of the intended result; elapsed time alone does not prove persistence. Closing right after «Отменить» lost the undo (2026-10-29).
- **A fresh browser starts in English**: add the cookie `lang=ru` before the first page (`reference_fresh_probe_starts_english`), and pick places by their buttons, not by text that depends on the Bible's language.
- **Select by role and name, as a person sees it** (`getByRole('button', { name: 'Готово', exact: true })`); a test id only where nothing visible names the thing. A screen redesigned the same day breaks a script that clicked an old row — update the script, not the screen (the analysis badge's window lost its row «Разбор · место» on 30.10; scripts open the analysis by «Открыть разбор …»).
- **Count, then look**: print the numbers that prove the outcome (flags, lines, arrows, the address) and take a screenshot to look at — a count says it happened, the picture says it looks right.
- **Close what you started**: the browser at the end of the script; the dev server at the end of the work unless the owner is trying the change on it (`fix-stuck-dev-server.md`).

## Examples

Historical scripts below describe the user journey; review and adapt their database/identity isolation before running them.

`.cases/2026-10-12-block-diagram/demo-analysis/live-batch.cjs` — the analysis's address, reload, five quick colour picks, ⌘Z and the badge window on the test user's Eph 1:1–2, every change undone; `live-untangle.cjs` — four links drawn, «Все связи» shot, the links removed.
