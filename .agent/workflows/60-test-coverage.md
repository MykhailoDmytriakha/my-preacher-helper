---
name: 60-test-coverage
description: "[60-test-coverage] VALIDATE. STRICT. Force ≥80% coverage for changed code (staged + unstaged). Key focus: 100% coverage of NEW/CHANGED logic. Run `npm run test:coverage && npm run lint:full` from root until BOTH green. No exceptions."
---

# Test Coverage Protocol — STRICT MODE

## Goal

**FORCE** coverage of all changed code (functions, methods, lines) at **≥80%** (file-wide) with a **primary mandate for 100% coverage of the specific logic introduced or modified**. Ensure **both** `npm run test:coverage` and `npm run lint:full` are **green**. Run from **root directory** only. No shortcuts. No exceptions.

## Invariant

```
npm run test:coverage && npm run lint:full
```

**Both must pass.** If either fails, fix and re-run. Do not stop until both are green.

---

## Workflow

### Phase 1: Identify Changed Files & Logic

1. **Get all changed files** (staged + unstaged):
   ```bash
   git diff --name-only
   git diff --name-only --staged
   ```
   Union both lists. Filter to **testable** files: `*.ts`, `*.tsx` under `frontend/app`, `frontend/locales`, `frontend/utils`, etc. (exclude config, mocks, `*.test.*`, `*.spec.*`).

2. **Identify specific line changes**:
   - Use `git diff -U0` to see exactly which lines were modified.

3. **Record** the list of changed files and the **logic blocks** (functions/branches) affected. These are the **primary coverage targets**.

### Phase 2: Baseline Coverage Measurement

> 🚨 **CRITICAL MANDATE: NEVER ASSUME COVERAGE** 🚨
> Do not just look at the overall file-wide percentage (e.g. `85%`). You **MUST** explicitly verify that your **exact modified lines** are not listed in the "Uncovered Line #s" column in the test report. Failing to verify the exact line numbers is a severe protocol breach!

4. **Run initial coverage** from root, specifically targeting the changed files to reduce noise:
   ```bash
   npm run test:coverage -- <path-to-changed-file1> <path-to-changed-file2>
   ```
   If it **fails** (tests red), fix valid test failures first.

5. **Record BASELINE coverage** and **UNCOVERED LINES**:
   - Identify the coverage % (Lines/Statements).
   - **CRUCIAL STEP: Cross-reference your `git diff` line numbers with the "Uncovered Line #s" from the Jest table.**
   - If your changed lines appear in the "Uncovered Line #s", **YOUR NEW LOGIC IS NOT COVERED**.
   - Example log: `utils/dateFormatter.ts: 50% (Baseline) - Lines 45-50 (NEW) are UNCOVERED`.

### Phase 3: Add Regression Tests for Changes

6. **Prioritize covering the DIFF**:
   - Even if the file has 90% coverage, if your **changes** are in the 10% uncovered part, you MUST add tests.
   - Focus on **newly added branches, edge cases, and bug fixes**.

7. **Write tests** that:
   - Specifically target the **modified lines and logic**.
   - Assert the **fix** for the bug or the **correctness** of the new feature.
   - Use mock data that reflects the specific scenarios handled in the diff.

8. **Re-run coverage**:
   ```bash
   npm run test:coverage
   ```
   Verify:
   - Changed file is **≥80%** overall.
   - **All modified/new lines are covered.**

### Phase 4: Lint Until Green

9. **Run full lint** from root:
   ```bash
   npm run lint:full
   ```
   This runs: `lint` → `compile` → `lint:unused`.

10. **Fix all lint/compile/unused errors**:
    - Do not leave any error unfixed.
    - Re-run `npm run lint:full` until it passes.

### Phase 5: Final Validation & Report

11. **Run the full invariant** from root:
    ```bash
    npm run test:coverage && npm run lint:full
    ```
    **Both must pass.**

12. **Generate Final Report**:
    - You **MUST** provide a comparison showing that the **changes** are specifically covered.
    - Format:
      ```
      | File | Baseline % | Final % | Changes Covered? | Status |
      |------|------------|---------|------------------|--------|
      | utils/api.ts | 45% | 85% | Yes (Lines 120-145) | ✅ |
      | components/Calc.tsx | 100% | 100% | Yes (Regression added) | ✅ |
      ```

---

## Validation Checklist

- [ ] Changed files AND specific changed line ranges identified via `git diff -U0`.
- [ ] `npm run test:coverage` output manually inspected for "Uncovered Line #s".
- [ ] Confirmed that **none of the modified lines** appear in the "Uncovered Line #s" column.
- [ ] Every single modified line is explicitly exercised by a test.
- [ ] File-wide coverage ≥80%.
- [ ] `npm run lint:full` passes.
- [ ] Final run: `npm run test:coverage && npm run lint:full` — both green.

---

## Output Expectations

- Provide the exact command used: `npm run test:coverage && npm run lint:full`.
- Explicitly state which **changed line ranges** or **newly added functions** are now covered.
- Provide before/after coverage comparison.
- Confirm both test:coverage and lint:full are green.

---

## Exclusions

- Files explicitly excluded in `jest.config.ts`.
- If no changed files are testable (e.g. only config changes), run the invariant anyway and report.

