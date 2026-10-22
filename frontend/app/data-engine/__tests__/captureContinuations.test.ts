import { CaptureContinuations } from '../captureContinuations';

describe('Explicit Save capture continuations', () => {
  it('finishes an earlier failed Save before a later registered Save', async () => {
    const captures = new CaptureContinuations(), seen: string[] = []; let blocked = true;
    const first = captures.register(async captured => { seen.push('first'); if (blocked) throw new Error('disk full'); captured(); return 'first captured'; });
    const second = captures.register(async captured => { seen.push('second'); captured(); return 'second captured'; });
    await expect(first()).rejects.toThrow('disk full'); expect(captures.failed).toBe(true); blocked = false;
    await expect(second()).resolves.toBe('second captured');
    expect(seen).toEqual(['first', 'first', 'second']); expect(captures.pending).toBe(false);
  });

  it('keeps distinct Save invocations for the same immutable snapshot', async () => {
    const captures = new CaptureContinuations(), snapshot = { text: 'same words' };
    const first = captures.register(async captured => { captured(); return snapshot; });
    const second = captures.register(async captured => { captured(); return snapshot; });
    await expect(first()).resolves.toBe(snapshot); expect(captures.pending).toBe(true);
    await expect(second()).resolves.toBe(snapshot); expect(captures.pending).toBe(false);
  });

  it('leaves a post-capture failure to the canonical request owner', async () => {
    const captures = new CaptureContinuations(); let attempts = 0;
    const save = captures.register(async captured => { attempts++; captured(); throw new Error('checkpoint projection'); });
    await expect(save()).rejects.toThrow('checkpoint projection');
    expect(captures.failed).toBe(false); expect(captures.pending).toBe(false);
    await captures.retry(); expect(attempts).toBe(1);
  });

  it('retires only attempts present at an explicit cancellation boundary', async () => {
    const captures = new CaptureContinuations();
    const old = captures.register(async captured => { captured(); return 'old'; });
    const boundary = captures.boundary();
    const next = captures.register(async captured => { captured(); return 'next'; });
    captures.retire(boundary);
    await expect(old()).rejects.toThrow('retired'); await expect(next()).resolves.toBe('next');
    expect(captures.pending).toBe(false);
  });

  it('keeps repeated capture failures retryable', async () => {
    const captures = new CaptureContinuations(); let attempts = 0;
    const save = captures.register(async captured => { if (++attempts < 3) throw new Error('disk full'); captured(); });
    await expect(save()).rejects.toThrow('disk full'); await expect(captures.retry()).rejects.toThrow('disk full');
    expect(captures.failed).toBe(true); await captures.retry();
    expect(attempts).toBe(3); expect(captures.pending).toBe(false);
  });

  it('lets later drafts persist after failure while remembering the explicit Save', async () => {
    const captures = new CaptureContinuations(); let blocked = true;
    const save = captures.register(async captured => { if (blocked) throw new Error('disk full'); captured(); });
    expect(captures.capturing).toBe(true);
    await expect(save()).rejects.toThrow('disk full');
    expect(captures.capturing).toBe(false); expect(captures.failed).toBe(true); expect(captures.pending).toBe(true);
    blocked = false; await captures.retry(); expect(captures.pending).toBe(false);
  });

  it('shares an in-flight capture without rerunning a completed invocation', async () => {
    const captures = new CaptureContinuations(); let release!: () => void, attempts = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const save = captures.register(async captured => { attempts++; await gate; captured(); return 'request'; });
    const first = save(); expect(save()).toBe(first); release();
    await expect(first).resolves.toBe('request'); await expect(save()).resolves.toBe('request'); expect(attempts).toBe(1);
  });
});
