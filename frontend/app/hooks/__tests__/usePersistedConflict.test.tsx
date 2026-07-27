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

  it('does not delete a conflict another tab stored later', () => {
    // Two tabs on one document share the slot, so the later refusal owns it. An
    // unconditional clear meant tab A, resolving its own conflict, destroyed tab
    // B's only copy of refused text.
    const tabA = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => tabA.result.current[1]({ payload: { title: 'from tab A' }, actualRevision: 5 }));

    const tabB = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => tabB.result.current[1]({ payload: { title: 'from tab B' }, actualRevision: 6 }));

    // Tab A resolves ITS conflict — tab B's stored record must survive.
    act(() => tabA.result.current[1](null));

    const afterReload = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    expect(afterReload.result.current[0]).toEqual({
      payload: { title: 'from tab B' },
      actualRevision: 6,
    });
  });

  /**
   * ONE HOOK INSTANCE SERVES MANY DOCUMENTS — a navigation re-renders the page, it
   * does not remount it. So "what this tab believes the pending conflict is" cannot
   * be a single value: a resolution for document A that finishes after the person
   * moved to document B compared A's record against B's slot, matched nothing, and
   * then deleted B's slot anyway — the only durable copy of a refusal B had not even
   * shown yet. Ownership has to be remembered PER DOCUMENT.
   */
  it('resolving document A does not destroy the refusal stored for document B', () => {
    const { result, rerender } = renderHook(
      ({ docId }: { docId: string }) => usePersistedConflict<{ title: string }>('u1', docId, 'meta'),
      { initialProps: { docId: 'doc-A' } }
    );

    act(() => result.current[1]({ payload: { title: 'refused on A' }, actualRevision: 5 }));

    // The person navigates to another document, which is refused too.
    rerender({ docId: 'doc-B' });
    act(() => result.current[1]({ payload: { title: 'refused on B' }, actualRevision: 8 }));

    // A's resolution lands late — it names the document it resolves.
    act(() => result.current[1](null, 'doc-A'));

    const reopenB = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-B', 'meta'));
    expect(reopenB.result.current[0]).toEqual({
      payload: { title: 'refused on B' },
      actualRevision: 8,
    });
    const reopenA = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-A', 'meta'));
    expect(reopenA.result.current[0]).toBeNull();
  });

  it('keeps showing the CURRENT document\'s refusal when another document resolves', () => {
    // The visible slot is one per hook, so a late resolution for A used to blank the
    // banner that was holding B's text. The disk still had it, but nothing on screen
    // did — the person sees their answer disappear.
    const { result, rerender } = renderHook(
      ({ docId }: { docId: string }) => usePersistedConflict<{ title: string }>('u1', docId, 'meta'),
      { initialProps: { docId: 'doc-A' } }
    );

    act(() => result.current[1]({ payload: { title: 'refused on A' }, actualRevision: 5 }));
    rerender({ docId: 'doc-B' });
    act(() => result.current[1]({ payload: { title: 'refused on B' }, actualRevision: 8 }));

    act(() => result.current[1](null, 'doc-A'));

    expect(result.current[0]).toEqual({ payload: { title: 'refused on B' }, actualRevision: 8 });
  });
});
