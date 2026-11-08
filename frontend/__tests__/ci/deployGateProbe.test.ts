// A deliberately red test, the proof that a red test keeps a deploy off the site (case
// 2026-09-29-github-actions-test-gate, 2026-11-08): pushed alone, its deployment must stay off the domain, and the very
// next commit removes it. If you read this in a working tree, it must not stay.
it('fails on purpose: the deploy of this commit must stay off the site', () => {
  expect('the deploy gate').toBe('held');
});
