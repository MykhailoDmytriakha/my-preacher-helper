import { createStore } from 'idb-keyval';

import {
  RELEASE_AFTER_MS, STORAGE_ANSWER_SETTLE_MS, STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS,
  resetDeviceStorageForTests, subscribeStorageRelease, trackStorage, watchedStore,
} from '@/utils/deviceStorage';

import type { StorageRelease } from '@/utils/deviceStorage';

/** What the page sees of the throwaway worker: created from a blob, told a name, terminated. */
class FakeWorker {
  static created: FakeWorker[] = [];
  readonly posted: unknown[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) { FakeWorker.created.push(this); }
  postMessage(message: unknown) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  say(data: unknown) { this.onmessage?.({ data }); }
}

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const never = () => new Promise(() => undefined);
const DECLARED = STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS + 10;

describe('a database held by a page Safari froze is released by asking for a version change', () => {
  const events: StorageRelease[] = [];
  let stop: () => void;
  beforeEach(() => {
    jest.useFakeTimers();
    FakeWorker.created = [];
    events.length = 0;
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:release') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
    jest.mocked(createStore).mockImplementation((() => jest.fn(never)) as unknown as typeof createStore);
    resetDeviceStorageForTests();
    stop = subscribeStorageRelease(event => events.push(event));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => { stop(); jest.useRealTimers(); });

  it('asks a throwaway worker for the next version once an engine database stays silent, then ends it', async () => {
    const store = watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    void store('readwrite', () => undefined);
    await jest.advanceTimersByTimeAsync(DECLARED);
    expect(FakeWorker.created).toHaveLength(0); // the person first gets a moment to go back
    await jest.advanceTimersByTimeAsync(RELEASE_AFTER_MS);
    expect(FakeWorker.created).toHaveLength(1);
    const [worker] = FakeWorker.created;
    expect(worker.posted).toEqual([{ name: 'preacher-data-engine-state-v1' }]);
    expect(events).toEqual([{ source: 'engine-state', result: 'asked' }]);
    await jest.advanceTimersByTimeAsync(1500);
    expect(worker.terminated).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:release');
  });

  it('reports what the worker found', async () => {
    const store = watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    void store('readwrite', () => undefined);
    await jest.advanceTimersByTimeAsync(DECLARED + RELEASE_AFTER_MS);
    FakeWorker.created[0].say('blocked');
    expect(events).toEqual([{ source: 'engine-state', result: 'asked' }, { source: 'engine-state', result: 'blocked' }]);
  });

  it('asks nobody when the database answers before the delay is over', async () => {
    let answer!: () => void;
    void trackStorage('engine-state', new Promise<void>(resolve => { answer = resolve; }));
    watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    await jest.advanceTimersByTimeAsync(DECLARED);
    answer();
    await jest.advanceTimersByTimeAsync(STORAGE_ANSWER_SETTLE_MS + RELEASE_AFTER_MS);
    expect(FakeWorker.created).toHaveLength(0);
  });

  it('asks once per silence, not once per waiting call', async () => {
    const store = watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    void store('readwrite', () => undefined);
    void store('readwrite', () => undefined);
    await jest.advanceTimersByTimeAsync(DECLARED + RELEASE_AFTER_MS + 2000);
    expect(FakeWorker.created).toHaveLength(1);
  });

  it('leaves databases outside the engine alone', async () => {
    const store = watchedStore('keyval-store', 'keyval', 'query-cache');
    void store('readonly', () => undefined);
    await jest.advanceTimersByTimeAsync(DECLARED + RELEASE_AFTER_MS);
    expect(FakeWorker.created).toHaveLength(0);
  });

  it('ends the worker on its first answer: Safari has evicted the frozen page by then', async () => {
    const store = watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    void store('readwrite', () => undefined);
    await jest.advanceTimersByTimeAsync(DECLARED + RELEASE_AFTER_MS);
    const [worker] = FakeWorker.created;
    worker.say('blocked');
    expect(worker.terminated).toBe(true);
  });

  it('ends a worker still asking when the page leaves, so the request cannot outlive it', async () => {
    const store = watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    void store('readwrite', () => undefined);
    await jest.advanceTimersByTimeAsync(DECLARED + RELEASE_AFTER_MS);
    const [worker] = FakeWorker.created;
    window.dispatchEvent(new Event('pagehide'));
    expect(worker.terminated).toBe(true);
  });

  it('asks once the page is seen again when it was hidden through the delay', async () => {
    const store = watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    void store('readwrite', () => undefined);
    await jest.advanceTimersByTimeAsync(DECLARED);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await jest.advanceTimersByTimeAsync(RELEASE_AFTER_MS * 2);
    expect(FakeWorker.created).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await jest.advanceTimersByTimeAsync(RELEASE_AFTER_MS);
    expect(FakeWorker.created).toHaveLength(1);
  });

  it('asks nobody when the waiting call answered and only the silence notice is still settling', async () => {
    let answer!: () => void;
    void trackStorage('engine-state', new Promise<void>(resolve => { answer = resolve; }));
    watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    await jest.advanceTimersByTimeAsync(DECLARED + 2000);
    answer(); // the notice clears 1.5 s later — after the release would fire
    await jest.advanceTimersByTimeAsync(RELEASE_AFTER_MS);
    expect(FakeWorker.created).toHaveLength(0);
  });

  it('leaves Chrome alone: it evicts frozen pages itself, and there a dropped request would stall later opens', async () => {
    const agent = jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36');
    const store = watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    void store('readwrite', () => undefined);
    await jest.advanceTimersByTimeAsync(DECLARED + RELEASE_AFTER_MS);
    expect(FakeWorker.created).toHaveLength(0);
    agent.mockRestore();
  });

  it('does not ask from a hidden page', async () => {
    const store = watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');
    void store('readwrite', () => undefined);
    await jest.advanceTimersByTimeAsync(DECLARED);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await jest.advanceTimersByTimeAsync(RELEASE_AFTER_MS);
    expect(FakeWorker.created).toHaveLength(0);
  });
});
