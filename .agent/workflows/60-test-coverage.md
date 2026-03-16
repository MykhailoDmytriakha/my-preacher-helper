---
name: 60-test-coverage
description: "[60-test-coverage] VALIDATE. STRICT. Mandatory 100% coverage of changed lines. File coverage < 80% → raise to ≥80%. File coverage ≥ 80% → raise further. Run `npm run test:coverage && npm run lint:full` from root until BOTH green. No exceptions."
---

# Test Coverage Protocol — STRICT MODE

## Three Non-Negotiable Rules

> These rules execute in order. Rule 1 is ALWAYS mandatory. Rules 2 and 3 are applied based on the pre-existing file baseline.

### Rule 1 — CHANGED LINES: 100% (ALWAYS MANDATORY)
Every line, branch, and function **introduced or modified** in this session MUST be covered and **explicitly asserted**. "Silent coverage" (file renders but behavior not verified) does NOT count. This rule applies regardless of file-wide percentage.

### Rule 2 — FILE BELOW 80%: Raise to ≥ 80%
If the changed file's **baseline** line coverage is **< 80%**, you MUST add enough tests to bring the file-wide coverage to **≥ 80%**. Do not stop at exactly 80% — aim for the next natural breakpoint.

### Rule 3 — FILE AT OR ABOVE 80%: Raise Further
If the changed file's baseline is **already ≥ 80%**, you MUST still add tests beyond Rule 1. Raise the file-wide percentage **by at least +5 percentage points** or to the next logical coverage ceiling — whichever is higher. Do NOT plateau at the existing level.

---

## Invariant

```bash
npm run test:coverage && npm run lint:full
```

**Both must pass.** If either fails, fix and re-run. Do not stop until both are green.

---

## Workflow

### Phase 1: Identify Changed Files & Logic

1. **Get ALL changed files** (session-wide: staged + unstaged):
   ```bash
   git diff --name-only
   git diff --name-only --staged
   ```
   **CRITICAL**: Union both lists. Do not skip files already staged. Filter to testable files: `*.ts`, `*.tsx` under `frontend/app`, `frontend/locales`, etc. Exclude config, mocks, `*.test.*`, `*.spec.*`.

2. **Identify specific changed lines**:
   ```bash
   git diff -U0
   git diff --staged -U0
   ```
   Record exact line ranges — these are your **primary coverage targets**.

### Phase 2: Baseline Coverage Measurement

> 🚨 **NEVER ASSUME COVERAGE** 🚨 You MUST cross-reference your diff line numbers with the "Uncovered Line #s" column. Failing to do this is a protocol breach.

3. **Run baseline coverage** targeting only the changed files:
   ```bash
   npm run test:coverage -- <path-to-changed-file1> <path-to-changed-file2>
   ```

4. **Record for each changed file**:
   - Baseline line coverage %
   - Uncovered line numbers
   - Which of your changed lines appear in "Uncovered Line #s" (those MUST be fixed)
   - Determine applicable rule: **Rule 2** (baseline < 80%) or **Rule 3** (baseline ≥ 80%)

### Phase 3: Write Tests

5. **Always apply Rule 1** — cover every changed/new line:
   - Write explicit assertions for the fix or new behavior.
   - Both branches of every changed conditional must be asserted, not just rendered.

6. **Apply Rule 2 or Rule 3** depending on baseline:
   - **Rule 2** (baseline < 80%): add tests until file-wide coverage ≥ 80%.
   - **Rule 3** (baseline ≥ 80%): add tests that push file-wide coverage up by ≥ +5pp or to the next logical ceiling.
   - In both cases: look at the "Uncovered Line #s" column and target the largest uncovered blocks first.

7. **Re-run coverage** and verify targets are met:
   ```bash
   npm run test:coverage -- <changed-files>
   ```

### Phase 4: Lint Until Green

8. **Run full lint** from root:
   ```bash
   npm run lint:full
   ```
   Fix ALL errors (lint + compile + unused). Re-run until exit code 0.

### Phase 5: Final Validation & Report

9. **Run the full invariant** from root:
   ```bash
   npm run test:coverage && npm run lint:full
   ```
   Both must be green.

10. **Generate Final Report** (required output):

```
| File | Baseline % | Final % | Δ | Rule Applied | Changed Lines Covered & Asserted? | Status |
|------|------------|---------|---|--------------|-----------------------------------|--------|
| FeedbackModal.tsx | 72% | 91% | +19pp | Rule 2 (→≥80%) | Yes (L18-28, createPortal branch) | ✅ |
| PreachDateModal.tsx | 88% | 95% | +7pp | Rule 3 (+5pp) | Yes (L34-40, mounted state) | ✅ |
```

---

## Validation Checklist

- [ ] Union of ALL changed files (staged + unstaged) identified.
- [ ] Exact changed line ranges from `git diff -U0` recorded.
- [ ] Baseline coverage % measured for each changed file.
- [ ] Rule determined per file: Rule 2 (< 80%) or Rule 3 (≥ 80%).
- [ ] **Rule 1**: ALL changed lines explicitly covered and asserted (not silently rendered).
- [ ] **Rule 2 or 3** target met: file-wide coverage raised as required.
- [ ] `npm run lint:full` passes — exit code 0.
- [ ] Final run: `npm run test:coverage && npm run lint:full` — both green.
- [ ] Final report generated with Baseline %, Final %, Δ, Rule Applied, Status.

---

## Exclusions

- Files explicitly excluded in `jest.config.ts`.
- SSR-only branches (e.g. `mounted = false` path in JSDOM) — document why they are acceptable and not counted against the rule targets.
- If no changed files are testable (only config/type changes), run the invariant anyway and confirm green.
