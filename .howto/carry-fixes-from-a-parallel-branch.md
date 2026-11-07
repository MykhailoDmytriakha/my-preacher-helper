when: carry fixes from Codex branch · take bug fixes from another branch into main · cherry-pick conflicts everywhere · merge the whole branch or not · codex/bugs-local-fixes · перенести фиксы из ветки Codex · забрать починенное · по одному багу · конфликты при cherry-pick · fast-forward Codex branch · light review order · land a big range · rules before code · перемотка main на ветку Codex · облегчённый порядок проверки

# Carry finished fixes from a parallel branch into main

Codex fixes bugs for weeks in its own worktree (`~/.codex/worktrees/bugs-local-fixes`, branch `codex/bugs-local-fixes`) and merges main into it now and then. Main takes the fixes piece by piece: each piece is verified, nothing extra comes along, nothing is reverted afterwards.

## How

- **Carry final files, not commits.** A commit is a patch against the main of the day it was written; on today's main it conflicts (2026-11-05: replaying all 248 commits in order, 5 applied, the 3rd already conflicted). After Codex has merged main, his version of a file is main plus his change, so taking that version cannot conflict. The script `.cases/2026-11-05-codex-intake-small/artifacts/piece.sh <commit>…` applies the commits to an intake worktree and then proves every code file byte-equal to the tip of his branch (`= TIP`); `≠ TIP` means another bug also touched the file — stop, it is not a separate piece.
- **A piece is a bundle of bugs that share code files.** Group the closed bugs by the files their commits touch; read bug IDs from the subject and, when the subject has none, from the body (`bundles.py` in the same folder). Counting by subject only made 28 "single" bugs out of 8.
- **Check what a piece leans on, not only what it changes.** A test that mocks a module the branch introduced (`@locales/useTranslation`), or a tracker closure that cites a fix commit only the branch has (`git merge-base --is-ancestor <sha> main`), belongs with that other piece.
- **Text files carry only his own lines.** `BUGS.md`: remove the entry by its heading (`rmbug.py BUGS.md <ID> <commit>` prints `IDENTICAL` when the removed text equals his removal). `.howto/`, `MEMORY.md`: when the patch conflicts, keep main's side and add exactly the lines his commit added (`resolve_plus.py`). His `docs/verification/` journal stays in his branch; the commit message points to it.
- **Red, then green, on main.** Apply only his test to the intake tree and see it fail, then the piece and see it pass. Behaviour no Jest test reaches (native typing speed) is accepted on his recorded browser A/B, named as such in the commit.
- **Gates on the intake worktree, then fast-forward.** Full `npm run test:fast`, `npx tsc --noEmit`, `npm run lint`, `node scripts/build-production.js` in the intake copy, a read-only live look (`live-intake.cjs`), then in the main checkout `git merge --ff-only <intake-branch>` (it refuses if another session's uncommitted file would be touched) and push.

## Once his branch contains main — fast-forward and keep landing

- **Whole branch by fast-forward.** When his branch already contains today's main, it is main plus his commits. `git merge --ff-only codex/bugs-local-fixes` in the main checkout then cannot conflict. On 2026-11-06 the data-engine bundle (~79 bugs) landed this way: `45d83239..bb2daba2`.
- **Per fix, the light order.** Codex commits each fix separately on a branch that contains main. Each commit carries its red→green test, the related tests, `tsc` and `lint`. Main does three things itself. First, an independent code review. Second, red→green on main: his tests on the parent must be red, on the fix green. Third, one full `npm run build` on the candidate tip. The heavy order took 67–105 min per fix and was dropped by the owner on 2026-11-06 (12:18). It added a native stand, archives and a fresh session to every fix; the light order takes 5–15 min. A returned fix goes back with the failing test or the exact screen.
- **Rules before code.** When the range changes `frontend/firestore.rules`, run `npm run test:rules`. Then deploy them (`npx firebase deploy --only firestore:rules --project my-preacher-helper`) before the push. Code that writes under the new rules must not reach production before the rules do.
- **A big landing grows the Vercel test run.** The build machine has 2 cores and 8 GB. Check `.howto/run-jest-tests.md` → `test:build` (`--workerIdleMemoryLimit=512MB`) before the first push of a large range.
- **Channel.** `.sessions/radio-claude-codex.md` (outside git, append-only): `### #N · Who → Whom · time`, each answer starts with «принял #N». A closed round ends with `РАЦИЯ ЗАКРЫТА`; the next session that lands his commits reads the radio's tail first.

## Why

- 2026-11-05 (`2026-11-05-codex-intake-small`): 313 commits on his branch. A whole-branch merge with reverts of bad fixes was rejected by the owner as confusing; commit-by-commit cherry-pick conflicted from the 3rd commit. Final files by bundle carried 6 bug closures (`d195e3ec`..`391f890a`) with zero conflicts in code. Outside one large bundle (the data engine core, ~79 closed bugs sharing `data-engine/engine.ts`, `react.client.tsx`, `controller.ts`) there were only 8 bundles / 9 bugs.

See also: `.howto/get-a-deploy-through-vercel.md` · `.howto/edit-a-shared-file.md`
