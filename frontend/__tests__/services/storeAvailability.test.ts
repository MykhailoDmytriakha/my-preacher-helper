/** @jest-environment node */
import { __resetStoreAvailabilityForTests, StoreUnavailableError, storeRetryHeaders, withStore } from '@/services/storeAvailability.server';

/**
 * BUG-20261019-quota-outage-burns-vercel-functions: with the daily quota spent, the server SDK retries
 * "Quota exceeded" for minutes, so a route that awaits it is killed at 10 s and billed for all of it,
 * while the browser gives up at 8 s and starts over. These tests pin what the guard owes the route.
 */
const never = () => new Promise<never>(() => undefined);
const after = <T,>(ms: number, value: T) => () => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
const quotaExceeded = () => Promise.reject(Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 }));

/** Settles `promise` while fake time runs, and says when — or that it had not by `untilMs`. */
async function settleWithin<T>(promise: Promise<T>, untilMs: number): Promise<{ at: number | null; value?: T; error?: unknown }> {
  const started = Date.now();
  let outcome: { at: number | null; value?: T; error?: unknown } = { at: null };
  promise.then(value => { outcome = { at: Date.now() - started, value }; }, error => { outcome = { at: Date.now() - started, error }; });
  await jest.advanceTimersByTimeAsync(0);
  for (let elapsed = 0; elapsed < untilMs && outcome.at === null; elapsed += 100) await jest.advanceTimersByTimeAsync(100);
  return outcome;
}

beforeEach(() => {
  jest.useFakeTimers();
  __resetStoreAvailabilityForTests();
});
afterEach(() => jest.useRealTimers());

describe('waiting for the store in a route the app calls by itself', () => {
  it('answers "unavailable" within a few seconds when the store never answers, well before the 8 s browser timeout', async () => {
    const outcome = await settleWithin(withStore(never), 20_000);
    expect(outcome.at).not.toBeNull();
    expect(outcome.at!).toBeLessThanOrEqual(3_000);
    expect(outcome.error).toBeInstanceOf(StoreUnavailableError);
  });

  it('gives a write more time than a read, still inside the browser timeout', async () => {
    const read = await settleWithin(withStore(after(4_000, 'read')), 20_000);
    expect(read.error).toBeInstanceOf(StoreUnavailableError);
    __resetStoreAvailabilityForTests();
    const write = await settleWithin(withStore(after(4_000, 'written'), { write: true }), 20_000);
    expect(write.value).toBe('written');
    const stalled = await settleWithin(withStore(never, { write: true }), 20_000);
    expect(stalled.at!).toBeLessThanOrEqual(6_000);
    expect(stalled.error).toBeInstanceOf(StoreUnavailableError);
  });

  it('lets an ordinary answer through untouched, even a slow one under the deadline', async () => {
    expect((await settleWithin(withStore(after(2_000, { id: 'sermon-1' })), 20_000)).value).toEqual({ id: 'sermon-1' });
  });

  it('after the store went silent, answers at once without asking it again, and asks again once the pause is over', async () => {
    await settleWithin(withStore(never), 20_000);
    const work = jest.fn(never);
    const repeat = await settleWithin(withStore(work), 20_000);
    expect(repeat.at).toBe(0);
    expect(repeat.error).toBeInstanceOf(StoreUnavailableError);
    expect(work).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(60_000);
    const healed = jest.fn(async () => 'fresh');
    expect((await settleWithin(withStore(healed), 20_000)).value).toBe('fresh');
    expect(healed).toHaveBeenCalledTimes(1);
  });

  it('treats "Quota exceeded" as unavailable at once and stops asking the store for a while', async () => {
    const first = await settleWithin(withStore(quotaExceeded), 20_000);
    expect(first.error).toBeInstanceOf(StoreUnavailableError);
    const work = jest.fn(async () => 'value');
    expect((await settleWithin(withStore(work), 20_000)).error).toBeInstanceOf(StoreUnavailableError);
    expect(work).not.toHaveBeenCalled();
  });

  it('passes any other failure through unchanged and keeps asking the store', async () => {
    const refusal = Object.assign(new Error('permission-denied'), { code: 'permission-denied', status: 403 });
    expect((await settleWithin(withStore(() => Promise.reject(refusal)), 20_000)).error).toBe(refusal);
    const work = jest.fn(async () => 'value');
    expect((await settleWithin(withStore(work), 20_000)).value).toBe('value');
    expect(work).toHaveBeenCalledTimes(1);
  });

  // Codex review 2026-10-19: a slow heartbeat paused the instance and the language the person chose
  // next was refused without being tried; the language selector keeps no journal to deliver it again.
  it('still attempts a write while reads are paused', async () => {
    await settleWithin(withStore(quotaExceeded), 20_000);
    const write = jest.fn(async () => 'saved');
    expect((await settleWithin(withStore(write, { write: true }), 20_000)).value).toBe('saved');
    expect(write).toHaveBeenCalledTimes(1);
  });

  // Codex review 2026-10-19: authentication took 2.5 s, the store got a fresh 3 s, and the answer came
  // at 5.5 s — after the 5 s browser timeout the deadline exists to beat.
  it('counts the deadline from when the request arrived, not from when the store was asked', async () => {
    const outcome = await settleWithin(withStore(never, { startedAt: performance.now() - 2_500 }), 20_000);
    expect(outcome.at!).toBeLessThanOrEqual(500);
    expect(outcome.error).toBeInstanceOf(StoreUnavailableError);
  });

  it('does not pause the store when the time ran out before the store was asked', async () => {
    const late = jest.fn(never);
    expect((await settleWithin(withStore(late, { startedAt: performance.now() - 10_000 }), 20_000)).error).toBeInstanceOf(StoreUnavailableError);
    expect(late).not.toHaveBeenCalled();
    const next = jest.fn(async () => 'value');
    expect((await settleWithin(withStore(next), 20_000)).value).toBe('value');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('tells the caller when to come back', async () => {
    const outcome = await settleWithin(withStore(quotaExceeded), 20_000);
    expect(Number(storeRetryHeaders(outcome.error)['Retry-After'])).toBeGreaterThan(0);
    expect(storeRetryHeaders(new Error('other'))).toEqual({});
  });
});
