when: bring main into a local bug-fix worktree · main intake · merge main without publishing · preserve local fixes during merge · conflicts in BibleBookReader · staged old conflict resolution · забрать main в worktree · обновления main в локальную ветку · сохранить локальные исправления при объединении

# Bring committed main changes into a local feature branch

Use the feature worktree. A main-to-feature intake does not publish the feature or change the owner's main working folder. The owner must authorize the intake and any resulting local commit; publication remains a separate action.

## Before merging

- Finish the current bug's accepted local commit and require a clean feature tree. Preserve the owner's other checkout and uncommitted work. Record feature HEAD, fetched main, merge base and branch name.
- Fetch main, then pin the exact target. Compare committed paths from the merge base on both sides as well as current working changes. A small dirty-file overlap does not establish that two committed histories merge safely.
- For diverged histories, `git merge --no-commit <pinned-main>` exposes conflicts without making the merge commit. Record MERGE_HEAD and the conflict list. Do not rebase the long accepted local history simply to avoid inspecting conflicts.

## Resolve contracts, then check the actual final tree

- Compose intended incoming behavior with the accepted local contracts. Do not take either entire side of a large component. Preserve canonical translation, the existing modal focus owner, scroll ownership, passage identity, current-place publication and persistence boundaries through their existing modules.
- Update tests to reach the actual new control while retaining their outcome assertions. A phone text popover is not a modal: a pinned-page regression must open an actual modal such as the translation picker. The reader test shell owns the shared visible place-control lookup.
- An integration/type/selector error is not a causal product RED. A newly discovered product bug needs its own causal regression and actual browser-before proof before changing product behavior.
- A before-only native baseline with known REDs may use the canonical production builder directly, with its purpose recorded as broken-before evidence. It is not an accepted build. Final acceptance still requires the official full-test build and all applicable gates.
- Inspect both working and staged diffs. `git diff --check` can pass while the index still contains an earlier conflict resolution; stage the reviewed final paths and also run `git diff --cached --check`.

## Validate and finish

- Run source/type/lint/locale checks and the official full build, then pin source, compiled output and service workers. Keep product bytes unchanged during native acceptance. Reuse those proven bytes instead of rerunning a large build solely because a conversation was compacted.
- Run native checks on isolated Auth/Firestore emulators, following `.howto/run-a-demo-on-the-emulator.md`. Check incoming UI and the accepted local behavior it touches, on actual phone/tablet/wide layouts. Inspect the rendered result personally and preserve failed diagnostics separately from passing scenarios.
- Record newly found defects in BUGS.md. Source equality is not proof that a runtime failure predates the merge. Distinguish the failed scope, source comparison, observed runtime and remaining investigation; never mark all controls green while carrying a known failed one.
- Export through the owned hubs, verify the payload, close every browser and stop owned PID-verified services. Take the macOS memory sample and verify ports are free. A fresh hand reruns the declared proof and critical tests before accepting the work.
- Refresh the remote main reference before the authorized local merge commit. If it moved, keep the accepted pinned intake explicit and plan the next intake; do not silently change sources under an active review. Verify both intended parent ancestries and clean status after committing. Do not push or deploy without the owner's separate instruction.

Unit182 records the seven-conflict intake of main4c5d5a9b into local8d8eaed1, its full10804-test build, native proof boundaries and an independently tracked wide-column centering defect. See `docs/verification/local-bug-fixes.md`.
