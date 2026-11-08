when: workerIdleMemoryLimit · Jest high memory · full suite timeout under load · Jest workers consume gigabytes · No tests found · No tests found, exiting with code 0 · run one test · run a single test file · app/(pages) path in jest · route group parentheses in jest path · [id] in jest path · --runTestsByPath · --listTests · npm run test vs npx jest · coverage threshold not met on one file · acceptance regex missed a suite · test:fast · test:build · JEST_SHOW_LOGS · console.log not shown in tests · new test file not picked up · -t test name filter · запустить тесты · запустить один тест · тесты не найдены · прогон тестов · путь со скобками · новый тест не подхватывается · логи в тестах · the click that ends a hold · verseCopyInReader fails under load · удержание щелчок под нагрузкой

# Run Jest tests

Run from `frontend/`. For one or a few files: `npx jest --runTestsByPath <path> …`. For the whole suite before a push: `npm run test:fast`. `npm run test` is the whole suite with coverage, not a way to run one file.

## How

- `npm run test` runs `jest --verbose --coverage` with the global `coverageThreshold` from `frontend/jest.config.ts`. On a single file it fails with "coverage threshold … not met" even when every test passes (checked 2026-09-27). For targeted runs use `npx jest`: Jest sets `NODE_ENV=test` itself, which the test-only `transpilePackages` in `frontend/next.config.mjs` needs.
- Positional arguments are regexes matched against the absolute path. Route folders break them: `(pages)` is a regex group and `[id]` a character class, so `app/(pages)/(private)/…` or `sermons/[id]/…` matches nothing and Jest prints "No tests found". Pass the literal path with `--runTestsByPath`, or escape it: `'app/\(pages\)/\(private\)/sermons/\[id\]/…'`. Listed beside paths that do match, such a path drops out silently: no "No tests found", only one suite fewer on the "Test Suites:" line.
- `test:fast`, `test:quick` and `test:ci` pass `--passWithNoTests`. A pattern that matches nothing prints "No tests found, exiting with code 0": a green exit with zero tests run. Read the "Test Suites:" line, not the exit code.
- Before trusting a regex run: `npx jest --listTests '<regex>'` prints the files it selects. Tests live in two trees — `frontend/__tests__/` and co-located `app/**/__tests__/`, plus a few `*.test.ts` files beside their source — so a regex written for one tree misses the other. Compare the suites that ran with every changed test file, and run any missing one by path.
- A new test file is picked up by Jest's default `testMatch`, since `frontend/jest.config.ts` sets none: any file in a `__tests__/` folder or named `*.test.ts(x)`. If a new file isn't collected, check the pattern and `testPathIgnorePatterns`; don't merge it into another file. The same rule collects a helper `.ts` placed under `__tests__/` as a suite, so keep helpers in `frontend/test-utils/` or list them in `testPathIgnorePatterns`, as is done for `storageHarness.ts`.
- One test inside a file: `-t '<part of its name>'`.
- `frontend/jest.setup.js` silences `console.*`. Run `JEST_SHOW_LOGS=true npx jest …` to see it.
- GitHub Actions run `npm run test:ci` in four parts (`.github/workflows/tests.yml`), the same run as `test:fast` with `--ci` and a failure-only reporter; the Vercel build runs no tests since 2026-11-08 (`.howto/get-a-deploy-through-vercel.md`).
- Independent runs in one worktree need distinct output paths for every artifact: Jest `--outputFile`, the final gates JSON, and each log. Check all literal paths before launch; changing only a log prefix leaves hardcoded reports shared. Refuse existing destinations. If one run overwrote another, preserve it as misattributed history and rerun into new disjoint names; never reconstruct a lost report from its counts or mix one run's log with another run's JSON.

## Bound a large local run without weakening its tests

A one-off full-suite timeout is not automatically a product regression or proof of a test bug. Preserve its full log and actual exit, repeat the exact test unchanged, and record uncertainty if the isolated result differs. Observe only owned processes with macOS `top -l 1 -pid <pid> -stats pid,mem`; do not use RSS as the monitor's memory value. Before stopping a failed run, verify the exact wrapper and descendant PIDs; a finished wrapper means no kill. Preserve the natural result.

`npm run test:ci` (the tests in GitHub Actions; until 2026-11-08 they ran inside the Vercel build as `test:build`) carries `--workerIdleMemoryLimit=512MB` since 2026-11-06: on Vercel's build machine two unbounded workers grew to ~3.5 GB each, one was SIGKILLed mid-suite and the build hung until the 45-minute limit (deployment `dpl_D2ABMGvNc9GUjmZWYzsEJmwAYKHM`); with the flag the same full suite passed locally, 13090 tests. It recycles workers between test files instead of allowing accumulated heap to grow throughout the suite. This is not a hard peak limit inside one file and does not change assertions or test timeouts. Record this actual command, counts and exit. After its successful full result, invoke the same `node scripts/build-production.js` used by `npm run build`, retaining its separate actual exit and log; do not report this as a successful `npm run build` invocation. Reuse earlier lint/type/translation gates only when every captured source pin remains identical; otherwise repeat the affected gate. A continued failure still needs diagnosis and must never be replaced by only the isolated pass. Unit246 records a 15s full-run timeout with an isolated301ms pass, and measured worker memory before/after recycling; the memory observation does not establish the timeout's cause.

## Why

- 2026-05-20 and 2026-09-05: raw `(pages)` paths returned "No tests found" — `--runTestsByPath` is the fix.
- 2026-07-12: a broad acceptance regex skipped a changed boundary test in the other `__tests__` tree.
- 2026-11-02: a red check listed two `__tests__/utils` files and one `app/(pages)/…` file; the third never ran, and two disabled fixes came back green until the suite count was read.

See also: `.howto/test-async-ui.md` · `.howto/mock-in-jest.md`

## A debounce never finishes in a real-timer test

`frontend/jest.setup.js` freezes `Date.now()` to stabilize older React Query tests. Lodash debounce checks elapsed time, so a real timeout alone cannot finish its wait while that clock stays frozen. For a behavior test that must wait out debounce, enable Jest fake timers after the asynchronous editor has opened, then advance the clock with `await act(async () => { await jest.advanceTimersByTimeAsync(750); })`. Restore real timers during cleanup. Do not increase the timeout or change the global clock policy for one test. Example: the restored meeting date in `frontend/__tests__/pages/group-detail-page.test.tsx`.

- For an isolated negative-control module outside the repository, Next SWC may rewrite an alias import to a relative require before Jest resolves it. Inspect the transformed importer in the isolated Jest cache and map that exact relative require (for example `^\\./useGroupMeetingEditor$`), rather than assuming the authored alias remains. Add the project node_modules absolute path to that temporary config modulePaths so the external copy can resolve React. A missing-module failure is harness failure, not a behavioral red. Verify the canonical source hash after the run.


For an agent's broad `test:fast`, pass an explicit `--maxWorkers=2` as well as `--workerIdleMemoryLimit=512MB`; the package's fast command otherwise inherits Jest's50%CPU worker setting. Recycling is not a peak memory cap. Avoid running another large Jest job beside it on a busy machine. After a deliberate interrupt, require a complete machine-readable test result and final summary: in Unit250 the npm wrapper returned0 after SIGINT to its exact owned Jest child, but produced no JSON result and had already logged a provider-readiness failure. Preserve that observation; do not turn wrapper0 or a later isolated pass into a successful original suite.

## A hold's trailing click counted as a press under load

`frontend/__tests__/components/bible/verseCopyInReader.test.tsx` — «the click that ends a hold takes nothing back» — failed once in a full `test:fast` run beside Codex's own Jest job and an 11 GB dev server (2026-11-07), and passed 4 of 4 alone. The click right after a hold is ignored for `CLICK_AFTER_HOLD_MS` (400 ms, `frontend/app/hooks/useLongPress.ts`) measured on the real clock (`performance.now()`); under swap pressure the render between the lift and the test's click took longer, and the click toggled the verse back off. Not a product regression: rerun the suite alone, and don't run another large Jest job beside `test:fast`.
