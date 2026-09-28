when: Vercel build failed · deploy blocked · deployment did not reach production · tests pass locally but build fails · green locally red on Vercel · npm run build · test:build · test:fast in build · build-production.js · type error blocks deploy · waitFor timeout on build machine · asyncUtilTimeout · { timeout: 2000 } · testTimeout · vercel inspect --logs · flag in Vercel env breaks tests · guard test counts app/dev · push to main · deploy status · commit status · статус деплоя · деплой · деплой не прошёл · сборка упала · сборка на Vercel · локально проходит на сборке падает · ошибка типов блокирует деплой · выкатка на прод · пуш в main

# Get a deploy through the Vercel build

A push to `main` deploys through Vercel, and the build runs the whole Jest suite first: `npm run build` in `frontend/` is `npm run test:build && node scripts/build-production.js`. One red test or one type error stops the deploy, and nothing else tells you. Before pushing run the FULL `npm run test:fast`, `npm run lint` and `npx tsc --noEmit`, not only the tests you touched.

## How

- `frontend/scripts/build-production.js` runs `next typegen` into `.next-typecheck`, then `next build` and `tsc -p tsconfig.build.json --noEmit` side by side; either one failing fails the build.
- `test:build` is the same Jest run with a failure-only reporter (`frontend/scripts/failure-only-jest-reporter.js`). It deliberately does not override `maxWorkers` (the config says `50%`).
- Tests live in two trees, `frontend/__tests__/` and co-located `app/**/__tests__/`. A targeted run, or a truncated `find | head`, misses the second one.
- Time: the build machine runs every suite on two cores, so anything timed is far slower there. `configure({ asyncUtilTimeout: 4000 })` in `frontend/jest.setup.js` is the ONE place that decides how long `waitFor` / `findBy*` wait, and `testTimeout: 15000` in `frontend/jest.config.ts` stays above it, so a starved expectation names itself instead of being cut off. `frontend/__tests__/architecture/asyncExpectationsHaveRoom.test.ts` freezes both. Never pin a shorter window in one test (`{ timeout: 2000 }`): it is the first to run out on a busy machine.
- After async work, wait for the CONDITION (`waitFor`, `findBy*`), never for a guessed number of microtask flushes.
- The build runs the suite with the production environment. A switch that changes which code path a screen takes must be cleared in `frontend/jest.setup.js` (it deletes `NEXT_PUBLIC_USE_CLIENT_*`, the DataEngine switches, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_ENABLE_TEST_LOGIN`). Simulate the build env by setting the variable on a local run, e.g. `NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS=councils DATA_ENGINE_COLLECTIONS=councils npm run test:fast`.
- Watch the result through the commit status, not the deployments list: `gh api repos/MykhailoDmytriakha/my-preacher-helper/commits/<sha>/status` shows the `Vercel` context as `pending` from the start of the build and `success`/`failure` at the end, with the build URL. The `/deployments` list got the entry only when the build finished (2026-09-28: `8359ece9` pending for about ten minutes and absent from that list), so a wait loop on it looks like "no deploy".
- A test that walks the filesystem as a gate must skip what git does not track: `app/dev/` is gitignored and exists on one disk only. See `NOT_IN_THE_REPOSITORY` in `frontend/__tests__/architecture/writesGoThroughTheInterface.test.ts`.

## When it goes wrong

- Read the failing deployment's own log: `npx vercel inspect <dpl_id> --logs`. Reproduce locally with `npm run build` (it runs `test:build` first), but not while `next dev` runs from the same `.next`.
- Green locally, red on the build machine: make the same failure appear locally with a perturbation. Delaying an awaited rejection by 30 ms turned the old assertion red and the fixed one green. If you could not reproduce it, say so plainly; a fix you have not reproduced is a guess.
- A guard test red on one machine and green on another measured the working copy. `applicationFiles` in `frontend/__tests__/architecture/firestoreBoundary.ts` does not skip `dev` yet: on a disk with `app/dev/` pages, `dataEngineBoundary.test.ts` fails on `dev/...` entries (seen 2026-09-27) while the build machine has none.

## Why

- 2026-05-25: a route change broke its co-located route test, which a truncated `find | head` had hidden; the correct fix never reached production.
- BUG-20260905: deployment `3450d526` failed on `PlanTemplatesSection.test.tsx`, green on the laptop, because a one-second async window ran out on the busy build machine.
- 2026-08-15: the write-interface guard counted gitignored `app/dev/`, and a prayer-modal test flushed one microtask expecting the refusal to have arrived (the build log still showed "Saving..."). The first "fix" hit the wrong test and broke a neighbour; only a control run caught it.

See also: `.howto/test-async-ui.md` · `.howto/run-jest-tests.md` · `.howto/roll-out-a-feature-switch.md` · `.howto/fix-stuck-dev-server.md`
