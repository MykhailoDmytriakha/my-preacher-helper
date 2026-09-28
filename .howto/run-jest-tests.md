when: No tests found · No tests found, exiting with code 0 · run one test · run a single test file · app/(pages) path in jest · route group parentheses in jest path · [id] in jest path · --runTestsByPath · --listTests · npm run test vs npx jest · coverage threshold not met on one file · acceptance regex missed a suite · test:fast · test:build · JEST_SHOW_LOGS · console.log not shown in tests · new test file not picked up · -t test name filter · запустить тесты · запустить один тест · тесты не найдены · прогон тестов · путь со скобками · новый тест не подхватывается · логи в тестах

# Run Jest tests

Run from `frontend/`. For one or a few files: `npx jest --runTestsByPath <path> …`. For the whole suite before a push: `npm run test:fast`. `npm run test` is the whole suite with coverage, not a way to run one file.

## How

- `npm run test` runs `jest --verbose --coverage` with the global `coverageThreshold` from `frontend/jest.config.ts`. On a single file it fails with "coverage threshold … not met" even when every test passes (checked 2026-09-27). For targeted runs use `npx jest`: Jest sets `NODE_ENV=test` itself, which the test-only `transpilePackages` in `frontend/next.config.mjs` needs.
- Positional arguments are regexes matched against the absolute path. Route folders break them: `(pages)` is a regex group and `[id]` a character class, so `app/(pages)/(private)/…` or `sermons/[id]/…` matches nothing and Jest prints "No tests found". Pass the literal path with `--runTestsByPath`, or escape it: `'app/\(pages\)/\(private\)/sermons/\[id\]/…'`.
- `test:fast`, `test:quick` and `test:build` pass `--passWithNoTests`. A pattern that matches nothing prints "No tests found, exiting with code 0": a green exit with zero tests run. Read the "Test Suites:" line, not the exit code.
- Before trusting a regex run: `npx jest --listTests '<regex>'` prints the files it selects. Tests live in two trees — `frontend/__tests__/` and co-located `app/**/__tests__/`, plus a few `*.test.ts` files beside their source — so a regex written for one tree misses the other. Compare the suites that ran with every changed test file, and run any missing one by path.
- A new test file is picked up by Jest's default `testMatch`, since `frontend/jest.config.ts` sets none: any file in a `__tests__/` folder or named `*.test.ts(x)`. If a new file isn't collected, check the pattern and `testPathIgnorePatterns`; don't merge it into another file. The same rule collects a helper `.ts` placed under `__tests__/` as a suite, so keep helpers in `frontend/test-utils/` or list them in `testPathIgnorePatterns`, as is done for `storageHarness.ts`.
- One test inside a file: `-t '<part of its name>'`.
- `frontend/jest.setup.js` silences `console.*`. Run `JEST_SHOW_LOGS=true npx jest …` to see it.
- The Vercel build runs `npm run test:build` (the `build` script), which is the same run as `test:fast` with a failure-only reporter.

## Why

- 2026-05-20 and 2026-09-05: raw `(pages)` paths returned "No tests found" — `--runTestsByPath` is the fix.
- 2026-07-12: a broad acceptance regex skipped a changed boundary test in the other `__tests__` tree.

See also: `.howto/test-async-ui.md` · `.howto/mock-in-jest.md`
