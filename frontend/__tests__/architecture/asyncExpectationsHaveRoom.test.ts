import { getConfig } from '@testing-library/dom';

/**
 * THE GATE MUST NOT FAIL FOR BEING BUSY.
 *
 * The whole suite runs on the build machine's two cores, where a timer that fires in
 * milliseconds here can take most of a second there. With Testing Library's default
 * one-second window, a perfectly healthy test then fails, the deployment stops, and a rerun of
 * the same commit passes — BUG-20260905, and the reason deployment `3450d526` failed on
 * `PlanTemplatesSection.test.tsx` while the same commit was green locally.
 *
 * This freezes the room those expectations are given. It is not a licence to wait: a real
 * regression still fails, it just takes four seconds to say so instead of one.
 */

/**
 * The ceiling Jest actually applies to a test: `jest.setTimeout` when a file called it, otherwise
 * the runner's own value, which already includes `testTimeout` from the config and `--testTimeout`.
 * jest-circus keeps that value in a state object under an unregistered symbol, so it is found by
 * its description. If a Jest upgrade renames it, this throws instead of comparing a guess
 * (BUG-20260928-timeout-guard-checks-its-own-fallback: a missing `jasmine` global once made this
 * guard compare its own fallback and pass with any ceiling).
 */
function effectiveTestTimeout(): number {
  const scope = globalThis as unknown as Record<symbol, unknown>;
  const override = scope[Symbol.for('TEST_TIMEOUT_SYMBOL')];
  if (typeof override === 'number') return override;
  const key = Object.getOwnPropertySymbols(globalThis).find(symbol => symbol.description === 'JEST_STATE_SYMBOL');
  const state = key ? (scope[key] as { testTimeout?: unknown } | undefined) : undefined;
  if (typeof state?.testTimeout !== 'number') {
    throw new Error('Cannot read the test timeout from the jest-circus state; update this guard for the current Jest runner.');
  }
  return state.testTimeout;
}

describe('async expectations have room to survive a busy machine', () => {
  it('waits four seconds before calling a slow machine a broken app', () => {
    expect(getConfig().asyncUtilTimeout).toBeGreaterThanOrEqual(4000);
  });

  it('leaves the per-test ceiling above that window, so the expectation reports itself', () => {
    // A test cut off by its own timeout says "exceeded timeout" and names nothing; an
    // expectation that runs out says which assertion never came true.
    expect(effectiveTestTimeout()).toBeGreaterThan(getConfig().asyncUtilTimeout);
  });
});
