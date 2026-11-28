when: upgrade path · old drafts on the device · what the new version does with data the old one left · rollback safety · two versions one browser profile · после обновления подхватит ли · старые черновики на устройстве · откат версии · переход со старой версии

# Check an upgrade on one browser profile

A test lives inside one version of the code, so it never sees what the previous version left on the owner's devices: localStorage drafts, engine queue records in IndexedDB, recovery checkpoints. Before landing anything that changes how drafts or queue records are written, run both versions against the same browser profile at the same origin.

## How

- Stand files: `.cases/2026-11-24-zabor-p7-codex-24-11/artifacts/stand2/` (`svc.cjs`, `lib.cjs`, `scenario.cjs`, `probe.cjs`, `webkit.cjs`, `newstep.cjs`, `timeline.cjs`). Copy them into a scratch folder.
- Two app copies: `git archive <old sha> frontend | tar -x -C run-old` and the same for the new sha (`run-new`); symlink `frontend/node_modules` and root `node_modules` from the main checkout; write the sha into `run-<name>/REV`.
- One emulator for the whole run (`node svc.cjs emu-start`: Auth + Firestore, demo project, nothing reaches production). One `next dev` at a time on the same port (`app-start old` → `app-stop` → `app-start new`), so the origin and therefore localStorage/IndexedDB stay the same.
- Playwright persistent context per scenario profile (`lib.cjs open(profile)`), Auth routed to the emulator, offline via `context.setOffline`.
- Scenarios: `scenario.cjs seed` (user + sets of service order, note, sermon) · `edit <profile> <set>` on the old build (load three screens online, go offline, type a marker, close) · `check <profile> <set>` on the new build (delivered to server? what the screen shows). Always run the same `edit`+`check` old→old first: that is what production does today and the yardstick for «not worse». Rollback: `edit` on new, `check` on old.
- Fast close: `webkit.cjs <set> <ms>` (`BROWSER=chromium` for Chrome) types and closes the browser `<ms>` after the last key, then reopens. Playwright WebKit needs `npx playwright install webkit` once (owner's permission, 24.11).
- Run the stand and Jest at different times: the stand's dev server and browsers starve Jest workers and produce false timeouts.
- Between `edit` and `check` nothing may open that profile online — not even a probe of the device database: any online visit lets the engine deliver the queued words, and `check` then reports `commands: 0` for a delivery made by the wrong version. Probes go after the checks. A fresh `seed` makes a new user, so a rerun needs new profile names (the old profile keeps the previous user's sign-in).
- Device database without upgrading it: `idx.cjs <profile>` (in `.cases/2026-11-27-zabor-vetki-codex-27-11/artifacts/stand/`) opens `preacher-data-engine-state-v1` with no version and prints its version and indexes. The stand needs `emulator/firebase.json` next to `svc.cjs` (Auth 9201, Firestore 8191, hub 4481, logging 4601, rules from `frontend/firestore.rules`); it is not in the old stand folder.

## Why

- 2026-11-24 (item 7 of the engine queue): 17 545 green tests and the author's live runs were all within one version. The stand found that the new version hid an unsaved plan cell behind a generic «Saved draft» list (production showed the words in a yellow panel), and after an upgrade showed two panels for the same words; WebKit fast-close found that a service step's words stayed a manual draft instead of resuming. Both were fixed before landing; rollback was shown to be forward-only.
- 2026-11-27 (Codex range `a3b26636d..f1a588186`, new IndexedDB index): the first run put the database probe between `edit` and `check`, so the upgrade and rollback checks saw words already delivered by the other version. Rerun with probes last: base, upgrade and rollback behaved alike; a profile born on the new version (index present) opened on the old one without errors.

See also: `.howto/carry-fixes-from-a-parallel-branch.md` · `.howto/run-a-demo-on-the-emulator.md` · `.howto/test-on-webkit.md`
