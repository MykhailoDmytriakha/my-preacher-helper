# Five utility module refactorings

The change separates five responsibilities while preserving the existing public entry points and their behavior. Three GPT-5.6 Luna agents implemented disjoint slices; the primary agent selected the boundaries, reviewed the changes, and ran integrated verification.

## Changes

| Refactoring | New owner | Preserved behavior |
| --- | --- | --- |
| Prayer search | `app/utils/prayerSearch.ts` | All-token matching within one field, optional search scopes, navigation priority, latest update and snippet formatting |
| Prayer sort policy | `app/utils/prayerSort.ts` | Filter defaults, allowed sort keys, filter transitions, date order and tie breaking, input immutability |
| Audio file operations | `app/utils/audioFileUtils.ts` | MIME mapping, size limits, byte signatures, file creation/naming, compatibility messages and diagnostics |
| Recorder selection/setup | `app/utils/mediaRecorderUtils.ts` | Format priority, platform exclusions, missing-browser fallbacks, constructor arguments and callbacks |
| Russian ordinal formatting | `app/utils/russianOrdinals.ts` | Existing tables, grammatical forms, compound numbers and unsupported-number fallback |

`prayerFilters.ts` remains the public entry point and list orchestrator. `audioFormatUtils.ts` explicitly re-exports the same runtime names and recorder type, including the existing download helper. `scriptureReferenceNormalizer.ts` retains parsing, locale detection, regex patterns and reference composition. No consumers need an import change.

The audio modules share one definition of MIME constants. Prayer search helpers remain private. None of the extracted modules imports its compatibility entry point, so these changes introduce no dependency cycle.

## Verification

- Baseline commit: `a01f98d1642f3aff2fd0c6e09179e43bfb33bf21`; working tree was clean before this task.
- Before edits, the three existing public-entry suites passed: 31 tests.
- Source audit: all 60 original top-level function/constant declarations retain the same TypeScript syntax trees, ignoring comments, formatting and export modifiers.
- Differential execution: 25,673 old/new comparisons agree, including public runtime export names, 4,019 prayer checks, 21,178 reference checks, 135 audio-file checks and 338 recorder checks.
- Negative controls: the comparison detects all five deliberate in-memory faults: weakened token matching, reversed sort direction, an audio-size off-by-one, a wrong stop callback, and a changed ordinal value. Working source files were never mutated for these controls.
- Five new direct test suites exercise the extracted modules; all existing tests are retained.
- Initial integrated gate passed: 614 suites / 5,779 tests; 91.22% overall line coverage. Full ESLint, TypeScript and unused-code checks passed.
- Production build passed, including the separate strict TypeScript check and generation of 46 static pages. Command: `node scripts/build-production.js` in `frontend`, after the full test gate.
- Direct audio coverage after adding missing edge assertions: both extracted audio modules have 100% line, branch and function coverage in the scoped run.
- Final integrated gate after the additional test-only assertions passed: **614 suites / 5,785 tests; 91.42% overall line coverage**, followed by successful lint, TypeScript and unused-code checks.

Required integrated command, from the repository root: `npm run test:coverage && npm run lint:full`. Global coverage thresholds and test configuration are unchanged. Five lint warnings occur in unchanged files (`care/orders/page.tsx`, `studies/[id]/page.tsx`, `api/service-orders/[id]/route.ts`, and two in `themeColors.ts`).

### Coverage of changed runtime files

Both columns are measured full-suite results **after extraction**: the first before adding the final edge assertions, the second on the delivered test state. They are not a pre-refactor coverage baseline. Each new runtime module has its own direct test suite. All files meet the 80% floor. Direct audio runs report 100% for both audio modules; the whole-suite aggregate reports different per-file values, shown without replacing them with the focused values.

| Runtime file | Initial integrated lines | Final integrated lines | Direct entry coverage |
| --- | ---: | ---: | --- |
| `prayerFilters.ts` | 100% | 100% | Existing public suite |
| `prayerSearch.ts` | 95% | 97.14% | New direct suite |
| `prayerSort.ts` | 100% | 100% | New direct suite |
| `audioFormatUtils.ts` | 100% | 100% | Existing public suite and export-name comparison |
| `audioFileUtils.ts` | 84.70% | 100% | New direct suite; scoped lines/branches/functions 100% |
| `mediaRecorderUtils.ts` | 93.57% | 86.42% | New direct suite; scoped lines/branches/functions 100% |
| `scriptureReferenceNormalizer.ts` | 82.27% | 82.72% | Existing public suite and differential execution |
| `russianOrdinals.ts` | 100% | 97.88% | New direct suite |

No production logic was added or rewritten: the only edits to existing runtime entry points are imports, re-exports and removal of relocated declarations. The source audit checks all relocated bodies/tables, including preserved guards that the public inputs cannot reach; tests do not distort production code to force those guards to execute.

## Limits and review scope

The equivalence comparisons establish agreement on the exercised inputs, not an absolute guarantee over every possible input or a certification that the baseline has no defects. Physical-device recording, live transcription and production deployment were not tested. UI trees, persistence, authentication, API schemas, cache keys and data-writing mechanisms were not modified.

The useful result is independent ownership of each responsibility, not a claim of improved runtime performance or fewer total lines. This packet has not been committed or published by this task.

Detailed commands, baseline snapshots and verification outputs are recorded in the local session evidence directory `.sessions/five-refactors-2026-09-11/`.
