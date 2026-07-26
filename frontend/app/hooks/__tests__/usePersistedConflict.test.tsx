import { act, renderHook } from '@testing-library/react';

import { usePersistedConflict } from '@/hooks/usePersistedConflict';

/**
 * A refused save must survive a reload.
 *
 * Adversarial review caught the trap: the rejected text was held only in
 * component state, so a reload, a crash or a stray navigation before the person
 * chose destroyed the only copy — the very failure the mechanism exists to
 * prevent, just moved one step later.
 */
describe('usePersistedConflict', () => {
  beforeEach(() => localStorage.clear());

  it('gives the refused text back after a remount (the "reload")', () => {
    const first = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => first.result.current[1]({ payload: { title: 'Typed on the laptop' }, actualRevision: 7 }));
    first.unmount();

    const second = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));

    expect(second.result.current[0]).toEqual({
      payload: { title: 'Typed on the laptop' },
      actualRevision: 7,
    });
  });

  it('forgets it once the person has resolved it', () => {
    const first = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => first.result.current[1]({ payload: { title: 'x' }, actualRevision: 7 }));
    act(() => first.result.current[1](null));
    first.unmount();

    const second = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));

    expect(second.result.current[0]).toBeNull();
  });

  it('does not carry a conflict across documents or aggregates', () => {
    const first = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => first.result.current[1]({ payload: { title: 'x' }, actualRevision: 7 }));
    first.unmount();

    const otherDoc = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-2', 'meta'));
    const otherAggregate = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'core'));

    expect(otherDoc.result.current[0]).toBeNull();
    expect(otherAggregate.result.current[0]).toBeNull();
  });

  it('stays inert until the document is known, instead of writing a junk key', () => {
    const { result } = renderHook(() => usePersistedConflict<{ title: string }>(null, null, 'meta'));

    act(() => result.current[1]({ payload: { title: 'x' }, actualRevision: 1 }));

    expect(result.current[0]).toEqual({ payload: { title: 'x' }, actualRevision: 1 });
    expect(Object.keys(localStorage)).toHaveLength(0);
  });
});
