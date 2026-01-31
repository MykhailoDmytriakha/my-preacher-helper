---
name: 60-test-coverage
description: "[60-test-coverage] VALIDATE. STRICT. Force ≥80% coverage for changed code (staged + unstaged). Run `npm run test:coverage && npm run lint:full` from root until BOTH green. No exceptions. Use when validating coverage for recent changes, adding tests for modified code, or ensuring nothing broke."
---

# Test Coverage Protocol — STRICT MODE

## Goal

**FORCE** coverage of all changed code (functions, methods, lines) at **≥80%** and ensure **both** `npm run test:coverage` and `npm run lint:full` are **green**. Run from **root directory** only. No shortcuts. No exceptions.

## Invariant

```
npm run test:coverage && npm run lint:full
```

**Both must pass.** If either fails, fix and re-run. Do not stop until both are green.

---

## Workflow

### Phase 1: Identify Changed Files

1. **Get all changed files** (staged + unstaged):
   ```bash
   git diff --name-only
   git diff --name-only --staged
   ```
   Union both lists. Filter to **testable** files: `*.ts`, `*.tsx` under `frontend/app`, `frontend/locales`, `frontend/utils`, etc. (exclude config, mocks, `*.test.*`, `*.spec.*`).

2. **Record** the list of changed files. These are the **coverage targets**.

### Phase 2: Baseline Coverage Measurement

3. **Run initial coverage** from root:
   ```bash
   npm run test:coverage
   ```
   If it **fails** (tests red), fix valid test failures first.

4. **Record BASELINE coverage** for each changed file:
   - Identify the coverage % (Lines/Statements) for every file found in Phase 1.
   - **Store this baseline.** You MUST report this value later to show improvement.
   - Example log: `utils/dateFormatter.ts: 50% (Baseline)`
   - If a changed file is **<80%**, it is a mandated target for Phase 3.

### Phase 3: Add Tests Until ≥80%

5. **Prioritize** changed files with coverage <80%:
   - Start with the lowest coverage.
   - Focus on **changed functions, methods, branches** — write tests that execute them.

6. **Write tests** that:
   - Directly exercise the **changed logic** (not just imports).
   - Assert behavior, edge cases, and failure paths.
   - Prefer behavior/structure assertions over snapshots.

7. **Re-run coverage**:
   ```bash
   npm run test:coverage
   ```
   Verify each changed file is **≥80%** (lines or statements). If not → repeat steps 5–7.

### Phase 4: Lint Until Green

8. **Run full lint** from root:
   ```bash
   npm run lint:full
   ```
   This runs: `lint` → `compile` → `lint:unused`.

9. **Fix all lint/compile/unused errors**:
   - Do not leave any error unfixed.
   - Re-run `npm run lint:full` until it passes.

### Phase 5: Final Validation

10. **Run the full invariant** from root:
    ```bash
    npm run test:coverage && npm run lint:full
    ```
    **Both must pass.** If either fails → return to the failing phase and fix.

11. **Report**:
    - List changed files and their final coverage %.
    - Confirm each changed file ≥80%.
    - Confirm `test:coverage` green.
    - Confirm `lint:full` green.

---

## Validation Checklist

- [ ] Changed files identified (staged + unstaged).
- [ ] `npm run test:coverage` passes.
- [ ] Each changed file has ≥80% coverage (lines/statements).
- [ ] `npm run lint:full` passes.
- [ ] Final run: `npm run test:coverage && npm run lint:full` — both green.

---

## Output Expectations

- Provide the exact command used: `npm run test:coverage && npm run lint:full` (from root).
- Provide per-file coverage for each changed file (before/after if tests were added).
- Explicitly state how changed code is exercised by tests.
- Confirm the 80% threshold is met for all changed files.
- Confirm both test:coverage and lint:full are green.

---

## Exclusions

- Files explicitly excluded in `jest.config.ts` (e.g. `layout.tsx`, `globals.css`) are not in scope.
- If a changed file is excluded by Jest `collectCoverageFrom`, document it and skip coverage check for that file.
- If no changed files are testable (e.g. only config changes), run the invariant anyway and report.
