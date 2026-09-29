#!/usr/bin/env bash
# Vercel "Ignored Build Step" (frontend/vercel.json -> ignoreCommand).
# Exit 0 cancels the build, exit 1 builds. Vercel runs this in the Root Directory (frontend/).
#
# It skips a build in one case only: a forward push after which nothing the app build or its tests read
# changed since the last successful deployment of this branch. Any doubt builds: a skipped release is
# worse than a spare build. It cannot see environment variables: after changing them, Redeploy (builds).
# Excluded paths are files neither `next build` nor Jest read: Firestore rules and their emulator
# checks, Firebase CLI config, and two top-level notes.

set -u

build() { echo "vercel-ignore-build: build - $1"; exit 1; }
skip() { echo "vercel-ignore-build: skip - $1"; exit 0; }

previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
current="${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null)}"

[ -n "$previous" ] || build "no previous successful deployment to compare with"
[ -n "$current" ] || build "current commit is unknown"
# Redeploying the same commit is how environment changes reach a new artifact.
[ "$previous" != "$current" ] || build "redeploy of the same commit"

# Vercel clones shallowly, so the previous deployment may be outside the clone.
if ! git cat-file -e "${previous}^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=1 origin "$previous" 2>/dev/null || build "previous deployment $previous is not reachable"
  git cat-file -e "${previous}^{commit}" 2>/dev/null || build "previous deployment $previous is not reachable"
fi

# Skip only a forward push. A redeploy or rollback of an older commit, a force push or another
# branch's history builds, and so does a previous commit whose ancestry the shallow clone cannot prove.
git merge-base --is-ancestor "$previous" "$current" 2>/dev/null || build "$previous is not a proven ancestor of $current"

git diff --quiet "$previous" "$current" -- \
  ':(top)frontend' \
  ':(top,exclude)frontend/firestore.rules' \
  ':(top,exclude)frontend/firestore.indexes.json' \
  ':(top,exclude)frontend/firebase.json' \
  ':(top,exclude)frontend/.firebaserc' \
  ':(top,exclude)frontend/rules-test.cjs' \
  ':(top,exclude)frontend/rules-test-closed.cjs' \
  ':(top,exclude)frontend/TESTING.md' \
  ':(top,exclude)frontend/WORD_EXPORT_FEATURES.md'
status=$?

case "$status" in
  0) skip "nothing the build reads changed since $previous" ;;
  1) build "app files changed since $previous" ;;
  *) build "git diff failed with status $status" ;;
esac
