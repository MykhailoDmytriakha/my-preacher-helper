import {
  __resetServerAvailabilityForTests,
  isServerUnavailable,
  reportServerAvailable,
  reportServerUnavailable,
  subscribeToServerAvailability,
} from '@/utils/serverAvailability';

// BUG-20261019-outage-said-as-two-check-lines: the browser learns once that our server cannot give
// the person's data, instead of every screen guessing it from its own failed check.
describe('serverAvailability', () => {
  beforeEach(() => { __resetServerAvailabilityForTests(); });

  it('says the server cannot give data after it answers "unavailable", and takes it back on a later success', () => {
    const heard = jest.fn();
    const stop = subscribeToServerAvailability(heard);
    expect(isServerUnavailable()).toBe(false);

    reportServerUnavailable(1);
    expect(isServerUnavailable()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);

    reportServerAvailable(2);
    expect(isServerUnavailable()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not let a late refusal of an older request overrule a newer success', () => {
    reportServerAvailable(5);
    reportServerUnavailable(4);
    expect(isServerUnavailable()).toBe(false);
  });

  // Codex review: an earlier success arriving late must not clear a newer refusal either.
  it('does not let a late success of an older request clear a newer refusal', () => {
    reportServerUnavailable(5);
    reportServerAvailable(4);
    expect(isServerUnavailable()).toBe(true);
  });

  it('tells listeners only about a change', () => {
    const heard = jest.fn();
    const stop = subscribeToServerAvailability(heard);
    reportServerUnavailable(1);
    reportServerUnavailable(2);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    reportServerAvailable(3);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
