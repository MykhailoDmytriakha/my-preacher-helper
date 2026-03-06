---
name: 60-test-coverage
description: "[60-test-coverage] VALIDATE. STRICT. After implementation is complete, discover all changed files/lines, force coverage of the diff, require a direct test seam for every new runtime file, and raise changed runtime files to ≥80% file-wide when needed. Run `npm run test:coverage && npm run lint:full` from root until BOTH green. No exceptions."
---

# Test Coverage Protocol — STRICT MODE

## Goal

**AFTER IMPLEMENTATION IS COMPLETE**, force coverage of all changed code (functions, methods, lines) with this order of priority:
1. **Scope**: determine exactly which files are in scope for this coverage pass.
2. **Discovery**: identify exactly which files and lines changed within that scope.
3. **Baseline table**: run coverage and record the current per-file coverage before writing tests.
4. **Diff coverage**: cover the specific new/modified logic first.
5. **Direct new-file seam**: every **new runtime file** added in the diff must have a **dedicated test suite/entry point** for that file. Incidental parent coverage is not enough by default.
6. **File floor**: if a changed runtime file is still below **80% file-wide coverage**, add tests until that file reaches **≥80%**.
7. **Comparison table**: after tests, run coverage again and compare baseline vs final per file.
8. **Root invariant**: both `npm run test:coverage` and `npm run lint:full` must be green.

Key mandate: **100% coverage of the specific logic introduced or modified**, **a direct suite for each new runtime file**, and **≥80% file-wide coverage for changed runtime files when they are below the floor**. This makes project coverage ratchet upward over time instead of only protecting the new lines.

## Invariant

```
npm run test:coverage && npm run lint:full
```

**Both must pass.** If either fails, fix and re-run. Do not stop until both are green.

---

## Workflow

### Phase 0: Implementation Freeze First

0. **Start only after code changes are done for the feature/refactor/fix**.
   - This skill is a **post-change validation/discovery pass**, not a substitute for implementation.
   - Do not start by guessing what may change later.
   - Run discovery against the actual final diff (staged + unstaged) that exists now.

### Phase 1: Identify Changed Files & Logic

1. **Determine scope first**.
   - Default scope: **union of staged + unstaged**.
   - If the user explicitly says `staged`, `indexed`, or names a path/package, restrict discovery to that scope and say so.
   - Default commands:
   ```bash
   git diff --name-only
   git diff --name-only --staged
   ```
   - Example explicit scopes:
     - `staged` -> `git diff --name-only --staged`
     - `unstaged` -> `git diff --name-only`
     - `package/path` -> intersect changed files with that subtree or named file set

2. **Get the concrete file list for the resolved scope**.
   Union both lists. Filter into:
   - **Runtime/testable files**: `*.ts`, `*.tsx` under `frontend/app`, `frontend/locales`, `frontend/utils`, etc.
   - **Non-runtime files**: config, mocks, `*.test.*`, `*.spec.*`, `README.md`, types-only contracts excluded by `jest.config.ts`.

   Only runtime/testable files are subject to the `≥80%` file floor.

3. **Identify specific line changes**:
   - Use `git diff -U0` to see exactly which lines were modified.
   - Prefer per-file diff ranges so you can say exactly which new lines/branches were exercised.

4. **Record** the list of changed files and the **logic blocks** (functions/branches) affected. These are the **primary coverage targets**.
   - Explicitly mark which changed runtime files are **NEW** versus **MODIFIED**.

### Phase 2: Baseline Coverage Measurement

5. **Run initial coverage** from root:
   ```bash
   npm run test:coverage
   ```
   If it **fails** (tests red), fix valid test failures first.

6. **Record BASELINE coverage** for each changed file:
   - Identify the coverage % (Lines/Statements).
   - **Crucially: Check if the CHANGED lines are uncovered** (check "Uncovered Line #s" in Jest output).
   - Example log: `utils/dateFormatter.ts: 50% (Baseline) - Lines 45-50 (NEW) are UNCOVERED`.
   - Print a baseline table before adding tests:
     ```
     | File | Scope | Baseline % | New or Modified | Direct Suite Present? |
     |------|-------|------------|-----------------|-----------------------|
     | app/foo.ts | staged | 62 | New | No |
     | app/bar.tsx | staged | 91 | Modified | Yes |
     ```

7. **Classify each changed runtime file into one of two cases**:
   - **Case A: Diff uncovered** — modified/new logic is not covered. Add targeted regression tests immediately.
   - **Case B: Diff covered but file <80%** — expand tests for the same file until the file reaches the floor.

   This distinction is mandatory. A file is not "done" just because the changed lines are covered if the file is still below `80%`.

### Phase 3: Add Regression Tests for Changes

7. **Prioritize covering the DIFF**:
   - Even if the file has 90% coverage, if your **changes** are in the 10% uncovered part, you MUST add tests.
   - Focus on **newly added branches, edge cases, and bug fixes**.

8. **Write tests** that:
   - Specifically target the **modified lines and logic**.
   - Assert the **fix** for the bug or the **correctness** of the new feature.
   - Use mock data that reflects the specific scenarios handled in the diff.

9. **For every NEW runtime file**, add or confirm a **direct file-level suite**:
   - Prefer a test that imports the file itself, or the exact public seam that resolves directly to that file.
   - The suite must exercise the new file's own branches/rendering/helpers, not only behavior through a larger parent component.
   - Re-export barrels (`index.ts`) count only if the suite explicitly verifies the re-export seam.

10. **If the changed runtime file is still below 80% after diff coverage is satisfied**:
   - Add the smallest reasonable set of tests to raise the whole file to `≥80%`.
   - Prefer adjacent branches/helpers in the same file instead of random unrelated tests.
   - Do **not** warp production code to satisfy coverage. Either:
     - add real tests, or
     - if the file is types-only / non-runtime, exclude it honestly in `jest.config.ts`.

11. **Re-run coverage**:
   ```bash
   npm run test:coverage
   ```
   Verify:
   - Changed file is **≥80%** overall.
   - **All modified/new lines are covered.**
   - **Every NEW runtime file has its own direct suite.**

12. **Print the final comparison table**:
    ```
    | File | Scope | Baseline % | Final % | Delta | >=80? | Changes Covered? | Direct Suite? |
    |------|-------|------------|---------|-------|-------|------------------|---------------|
    | app/foo.ts | staged | 62 | 88 | +26 | Yes | Yes | Yes |
    ```

### Phase 4: Lint Until Green

13. **Run full lint** from root:
   ```bash
   npm run lint:full
   ```
   This runs: `lint` → `compile` → `lint:unused`.

14. **Fix all lint/compile/unused errors**:
    - Do not leave any error unfixed.
    - Re-run `npm run lint:full` until it passes.

### Phase 5: Final Validation & Report

15. **Run the full invariant** from root:
    ```bash
    npm run test:coverage && npm run lint:full
    ```
    **Both must pass.**

16. **Generate Final Report**:
    - You **MUST** provide a comparison showing that the **changes** are specifically covered.
    - You **MUST** show baseline vs final coverage for every scoped runtime file.
    - Format:
      ```
      | File | Scope | Baseline % | Final % | Delta | >=80? | Changes Covered? | Status |
      |------|-------|------------|---------|-------|-------|------------------|--------|
      | utils/api.ts | staged | 45% | 85% | +40 | Yes | Yes (Lines 120-145) | ✅ |
      | components/Calc.tsx | staged | 100% | 100% | 0 | Yes | Yes (Regression added) | ✅ |
      ```

---

## Validation Checklist

- [ ] Changed files AND changed line ranges identified.
- [ ] Scope for discovery was explicitly determined and stated.
- [ ] Discovery ran only after implementation was complete.
- [ ] `npm run test:coverage` passes.
- [ ] Baseline per-file coverage table was printed before new tests were added.
- [ ] Every single modified line is exercised by a test.
- [ ] Every new runtime file has a direct dedicated suite, not only incidental parent coverage.
- [ ] Every changed runtime file is at file-wide coverage ≥80%, or is honestly excluded as non-runtime/types-only.
- [ ] Final baseline-vs-final comparison table was printed.
- [ ] `npm run lint:full` passes.
- [ ] Final run: `npm run test:coverage && npm run lint:full` — both green.

---

## Output Expectations

- Provide the exact command used: `npm run test:coverage && npm run lint:full`.
- State the resolved scope explicitly (`staged`, `unstaged`, `staged + unstaged`, or custom path/package).
- Explicitly separate:
  - files whose diff was already covered
  - new runtime files that required a direct suite to satisfy the contract
  - files that required extra tests only to raise the file-wide floor to `≥80%`
- Explicitly state which **changed line ranges** or **newly added functions** are now covered.
- Provide before/after coverage comparison.
- Confirm both test:coverage and lint:full are green.

---

## Exclusions

- Files explicitly excluded in `jest.config.ts`.
- Types-only contracts or non-runtime artifacts may be excluded, but only honestly and explicitly.
- If no changed files are testable (e.g. only config changes), run the invariant anyway and report.
