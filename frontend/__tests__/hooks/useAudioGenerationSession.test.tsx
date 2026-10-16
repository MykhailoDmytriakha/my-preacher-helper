import { act, renderHook } from '@testing-library/react';

import { useAudioGenerationSession } from '@/hooks/useAudioGenerationSession';

import type { AudioGenerationRun } from '@/hooks/useAudioGenerationSession';

const body = { provider: 'openai', expected: [{ text: 'Saved words' }] };

describe('audio generation session ownership', () => {
  it('keeps a newer run when old progress, completion, failure and finally arrive', () => {
    const { result } = renderHook(() => useAudioGenerationSession('owner', 'sermon'));
    let older!: AudioGenerationRun, newer!: AudioGenerationRun;
    act(() => { older = result.current.begin(body, 4)!; });
    act(() => { newer = result.current.begin({ ...body, voice: 'echo' }, 2)!; });
    expect(older.controller.signal.aborted).toBe(true);
    expect(() => older.checkpoint()).toThrow(expect.objectContaining({ name: 'AbortError' }));
    act(() => {
      result.current.report(older, { current: 99, total: 99 });
      result.current.fail(older); result.current.finish(older);
      expect(result.current.complete(older, { url: 'blob:old', filename: 'old.mp3' })).toBe(false);
    });
    expect(result.current.view).toBe('generating');
    expect(result.current.genProgress).toMatchObject({ current: 0, total: 2 });
    expect(result.current.generatedFile).toBeNull();
    expect(result.current.isCurrent(newer)).toBe(true);
    expect(() => newer.checkpoint()).not.toThrow();
  });

  it('cancels immediately, retains finished same-body parts and discards them for changed inputs', () => {
    const { result } = renderHook(() => useAudioGenerationSession('owner', 'sermon'));
    let older!: AudioGenerationRun, retry!: AudioGenerationRun, changed!: AudioGenerationRun;
    act(() => { older = result.current.begin(body, 4)!; });
    older.progress.parts.push(new Uint8Array([1, 2]));
    older.progress.nextOffset = 3;
    act(() => { expect(result.current.cancel()).toBe(true); });
    expect(result.current.view).toBe('working');
    expect(() => older.checkpoint()).toThrow();
    act(() => { retry = result.current.begin(body, 4)!; result.current.finish(older); });
    expect(retry.progress.nextOffset).toBe(3);
    expect(retry.progress.parts.map(part => [...part])).toEqual([[1, 2]]);
    expect(result.current.isCurrent(retry)).toBe(true);
    act(() => { changed = result.current.begin({ ...body, voice: 'echo' }, 4)!; });
    expect(changed.progress.nextOffset).toBe(0);
    expect(changed.progress.parts).toEqual([]);
  });

  it('shows no previous result or completed parts after an owner and sermon change', () => {
    const { result, rerender } = renderHook(props => useAudioGenerationSession(props.owner, props.sermon), { initialProps: { owner: 'first', sermon: 'one' } });
    let older!: AudioGenerationRun, newer!: AudioGenerationRun;
    act(() => {
      older = result.current.begin(body, 1)!;
      result.current.complete(older, { url: 'blob:old', filename: 'old.mp3' });
      result.current.finish(older);
    });
    expect(result.current.view).toBe('success');
    rerender({ owner: 'second', sermon: 'two' });
    expect(result.current.view).toBe('working');
    expect(result.current.generatedFile).toBeNull();
    act(() => { newer = result.current.begin(body, 1)!; });
    expect(newer.progress.nextOffset).toBe(0);
    expect(newer.progress.parts).toEqual([]);
    expect(result.current.complete(older, { url: 'blob:late', filename: 'late.mp3' })).toBe(false);
  });

  it('aborts an active run and retires its checkpoint when the window unmounts', () => {
    const { result, unmount } = renderHook(() => useAudioGenerationSession('owner', 'sermon'));
    let run!: AudioGenerationRun;
    act(() => { run = result.current.begin(body, 1)!; });
    unmount();
    expect(run.controller.signal.aborted).toBe(true);
    expect(() => run.checkpoint()).toThrow(expect.objectContaining({ name: 'AbortError' }));
  });
});
