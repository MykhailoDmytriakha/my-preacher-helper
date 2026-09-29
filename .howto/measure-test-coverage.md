when: coverage below 80% · 80% per file · 3-rule coverage protocol · raise coverage · measure coverage of one file · test:coverage · lcov.info · coverage-summary.json · collectCoverageFrom · coveragePathIgnorePatterns · coverageThreshold · Jest: "global" coverage threshold for lines (89.57%) not met · diff coverage · uncovered lines that tests do run · types-only file in coverage · 0% file · istanbul ignore · jest --no-cache · jest --clearCache · test:summary broken · coverage differs between runs · V8 coverage noise · coverageProvider babel · покрытие тестами · покрытие ниже 80 · поднять покрытие · замерить покрытие файла · непокрытые строки · порог покрытия · отчёт о покрытии

# Measure and raise test coverage

From the repository root run `npm run test:coverage && npm run lint:full` until both are green, and read per-file numbers from `frontend/coverage/lcov.info` (plus `coverage-summary.json` beside it). What is counted is set in `frontend/jest.config.ts` (`collectCoverageFrom`, `coveragePathIgnorePatterns`, provider `v8`).

## How

- Three rules on every code change. Rule 1: 100% of the changed runtime lines are covered AND asserted — always. Rule 2: a changed file below 80% is raised to at least 80%. Rule 3: a changed file already at 80% or more is raised by at least 5 points. Judge per file: a high project total hides files sitting at 0%.
- Run strict coverage discovery only after the implementation is finished: first cover the modified lines of the final diff, then keep adding tests until every changed runtime file is at 80% or more.
- State the scope before the pass. Default: staged + unstaged changes. If the person says "staged" or names a path or package, restrict discovery to that and name the scope in the report.
- Every new runtime file in scope gets its own direct suite, aimed at the file or its exact public seam. Coverage that arrives through a parent component does not count, even above 80%.
- An extracted browser hook gets direct hook tests for modern `matchMedia`, legacy listeners, the resize fallback and timer/cleanup seams. If effect cleanup makes a duplicated teardown branch dead, delete the branch instead of chasing it.
- Diff coverage: even with both commands green, check a merged refactor stack by comparing `git diff -U0 <start>^..HEAD` with `frontend/coverage/lcov.info`. A healthy file percentage hides uncovered changed lines.
- One file, fast: from `frontend/`, `npx jest --runTestsByPath <test> --coverage --collectCoverageFrom=<file>`.

## Excluding a file

- A types-only module (no runtime code) is excluded in the same change that adds it: `'!app/.../types.ts'` in `collectCoverageFrom` and a matching `coveragePathIgnorePatterns` line. Put it back when it gains runtime logic.
- Exclusion is config only. `json-summary` is among the reporters, so `coverage-summary.json` is fresh after every run. Avoid `/* istanbul ignore file */` unless a verified edge case still leaks through after a real rerun.
- A 0% file is not automatically an exclusion. First separate framework entrypoints (`page.tsx`, `route.ts`) from ordinary modules, then prove who imports it. Ordinary module with no live consumer → delete it. Types-only → exclude. Live runtime module → keep it and test it. Framework shells (`layout`, `loading`, `template`, `error`, `not-found`) are already excluded in the config.

## Traps

- A focused `jest --coverage` run without `--collectCoverageFrom` counts every file under `app/**` at 0% and exits 1 on `coverageThreshold.global` (`Jest: "global" coverage threshold for lines (89.57%) not met`) even though every test passed.
- Diff coverage shows lines as uncovered that a test demonstrably runs → Jest's cache survived a helper refactor. Confirm with a focused `npx jest --coverage --no-cache` run. If it shows the lines hit, clear the cache (`npx jest --clearCache`; it lives in `frontend/.next/cache/jest`) before the final full `npm run test:coverage`, so the new `lcov.info` matches reality.
- Do not force `typeof document === 'undefined'` branches in JSDOM tests by replacing `global.document`: it can destabilize jsdom's event loop. Cover the real browser branches and accept the non-browser fallback unless you have a dedicated non-DOM test environment.
- IndexedDB branches: cover them with isolated module imports (`jest.isolateModules`) plus a `jest.mock('idb-keyval', ...)` mock, never by bending runtime code to satisfy the metric.
- Some branches are unreachable with valid input (drag and drop tops out near 95%). Accept the ceiling instead of feeding invalid inputs to reach 100%.
- `npm run test:summary` is broken: it runs `show-total-coverage.js`, which does not exist.
- The configured V8 provider is not repeatable here: two identical full runs of the same commit differed in 212 files (branches 83.89 % vs 84.31 %, 2026-09-29). Never judge "did this change lose coverage" by V8 totals. Compare two runs of `--coverageProvider=babel` (instrumented counters, deterministic) on clean copies of the base and of the change.

## Why

- 2026-02-02: a high project-wide number hid files with zero coverage, so the bar is 80% per file.
- 2026-09-29: a test cleanup looked like it lost 0.8 % of branches; a second run of the untouched base moved by 0.4 % on its own.
- 2026-03-18: strict diff coverage reported "uncovered" lines that the tests ran; a stale Jest cache had survived a helper refactor.

See also: `.howto/run-jest-tests.md` · `.howto/mock-browser-apis-in-jest.md` · `.howto/remove-code-or-feature.md`
