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
describe('async expectations have room to survive a busy machine', () => {
  it('waits four seconds before calling a slow machine a broken app', () => {
    expect(getConfig().asyncUtilTimeout).toBeGreaterThanOrEqual(4000);
  });

  it('leaves the per-test ceiling above that window, so the expectation reports itself', () => {
    // A test cut off by its own timeout says "exceeded timeout" and names nothing; an
    // expectation that runs out says which assertion never came true.
    const testTimeout = (global as unknown as { jasmine?: { DEFAULT_TIMEOUT_INTERVAL?: number } }).jasmine
      ?.DEFAULT_TIMEOUT_INTERVAL ?? 15000;
    expect(testTimeout).toBeGreaterThan(getConfig().asyncUtilTimeout);
  });
});
