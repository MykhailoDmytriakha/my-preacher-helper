import { DebouncedDocWriter } from '@/utils/debouncedDocWriter';

describe('DebouncedDocWriter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // A write settles through catch → finally → the awaiting send: several microtask turns.
  const flushMicrotasks = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  it('sends the latest copy once the typing pauses, not every keystroke', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const writer = new DebouncedDocWriter<string>(write, 700);
    writer.schedule('a', 'v1');
    writer.schedule('a', 'v2');
    jest.advanceTimersByTime(699);
    expect(write).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('a', 'v2', {});
  });

  it('never has two writes of one document in flight: a change during a write goes right after it', async () => {
    let release: () => void = () => undefined;
    const write = jest.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    const writer = new DebouncedDocWriter<string>(write, 700);
    writer.schedule('a', 'v1');
    jest.advanceTimersByTime(700);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);

    writer.schedule('a', 'v2');
    jest.advanceTimersByTime(700);
    await flushMicrotasks();
    // Still one: the first write has not landed.
    expect(write).toHaveBeenCalledTimes(1);

    release();
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith('a', 'v2', {});
    // …and the second write settles on its own, with nothing left waiting.
    for (let i = 0; i < 50 && writer.isPending('a'); i += 1) {
      jest.advanceTimersByTime(1);
      await flushMicrotasks();
    }
    expect(writer.isPending('a')).toBe(false);
  });

  it('keeps a failed copy pending and reports the failure', async () => {
    const write = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const onError = jest.fn();
    const writer = new DebouncedDocWriter<string>(write, 700, onError);
    writer.schedule('a', 'v1');
    jest.advanceTimersByTime(700);
    await flushMicrotasks();
    expect(onError).toHaveBeenCalledWith('a', expect.any(Error));
    expect(writer.isPending('a')).toBe(true);

    await writer.flush('a');
    expect(write).toHaveBeenCalledTimes(2);
    expect(writer.isPending('a')).toBe(false);
  });

  it('flush sends everything pending at once and forget drops a document', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const writer = new DebouncedDocWriter<string>(write, 700);
    writer.schedule('a', 'v1');
    writer.schedule('b', 'v1');
    writer.forget('b');
    await writer.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('a', 'v1', {});
  });

  it('carries the caller options into the write, so the last save on the way out can keep alive', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const writer = new DebouncedDocWriter<string>(write, 700);
    writer.schedule('a', 'v1');
    await writer.flush(undefined, { keepalive: true });
    expect(write).toHaveBeenCalledWith('a', 'v1', { keepalive: true });
  });

  it('rebases the waiting copy, so a change typed during a write is not refused as stale', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const writer = new DebouncedDocWriter<{ text: string; rev: number }>(write, 700);
    writer.schedule('a', { text: 'typed while the first write flew', rev: 0 });
    writer.rebase('a', (doc) => ({ ...doc, rev: 1 }));
    await writer.flush('a');
    expect(write).toHaveBeenCalledWith('a', { text: 'typed while the first write flew', rev: 1 }, {});
  });

  it('keeps a refused copy pending instead of counting it delivered', async () => {
    const write = jest.fn().mockRejectedValue(new Error('refused'));
    const writer = new DebouncedDocWriter<string>(write, 700, () => undefined);
    writer.schedule('a', 'v1');
    jest.advanceTimersByTime(700);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);
    expect(writer.isPending('a')).toBe(true);
  });

  it('does not re-queue a document that was deleted while its write was in the air', async () => {
    let reject: (error: Error) => void = () => undefined;
    const write = jest.fn().mockImplementation(() => new Promise<void>((_, no) => { reject = no; }));
    const writer = new DebouncedDocWriter<string>(write, 700, () => undefined);
    writer.schedule('a', 'v1');
    jest.advanceTimersByTime(700);
    await flushMicrotasks();
    writer.forget('a');
    reject(new Error('refused'));
    await flushMicrotasks();
    // The council is gone; its failed copy must not come back and be written again.
    expect(writer.isPending('a')).toBe(false);
  });

  it('keeps keepalive on the copy left behind by a write that was already in the air', async () => {
    let release: () => void = () => undefined;
    const write = jest
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
      .mockResolvedValue(undefined);
    const writer = new DebouncedDocWriter<string>(write, 700);
    writer.schedule('a', 'v1');
    jest.advanceTimersByTime(700);
    await flushMicrotasks();

    writer.schedule('a', 'v2');
    const leaving = writer.flush(undefined, { keepalive: true });
    release();
    await leaving;
    await flushMicrotasks();
    expect(write).toHaveBeenLastCalledWith('a', 'v2', { keepalive: true });
  });

  it('sends at once, not in 700 ms, for a change made while the page is closing', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const writer = new DebouncedDocWriter<string>(write, 700);
    await writer.flush(undefined, { keepalive: true });
    // A panel handing over its text during pagehide: there is no 700 ms left to wait.
    writer.schedule('a', 'typed at the door');
    await flushMicrotasks();
    expect(write).toHaveBeenCalledWith('a', 'typed at the door', { keepalive: true });
  });
});
