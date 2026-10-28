import { act, renderHook } from '@testing-library/react';

import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { draftKey, findDraftCopies, readDraft, saveDraft } from '@/utils/durableDraft';

/**
 * A refused save must survive a reload.
 *
 * Adversarial review caught the trap: the rejected text was held only in
 * component state, so a reload, a crash or a stray navigation before the person
 * chose destroyed the only copy — the very failure the mechanism exists to
 * prevent, just moved one step later.
 */
describe('usePersistedConflict', () => {
  it('resolves the selected original key when a missing entry reappears with equal bytes', () => {
    const value = { payload: { title: 'Equal retained words' }, actualRevision: 1 };
    const original = draftKey('u1', 'doc-1', 'conflict:meta');
    const other = draftKey('u1', 'doc-1', 'conflict:meta', 'other');
    saveDraft(original, value); saveDraft(other, { payload: { title: 'Other words' }, actualRevision: 2 });
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    try {
      localStorage.removeItem(original);
      act(() => { window.dispatchEvent(new StorageEvent('storage', { key: original })); });
      saveDraft(original, value);
      act(() => { window.dispatchEvent(new Event('focus')); });
      act(() => { view.result.current[3].select(original); });
      expect(view.result.current[3].selectedKey).toBe(original);
      const selected = view.result.current[0]!;
      act(() => { view.result.current[1](null, 'doc-1', selected); });
      expect(readDraft(original)).toBeNull();
      expect(readDraft(other)?.value).toEqual({ payload: { title: 'Other words' }, actualRevision: 2 });
    } finally { view.unmount(); }
  });

  it('keeps physical choice bindings distinct when two new refusals reuse one object', () => {
    const value = { payload: { title: 'Same object words' }, actualRevision: 1 };
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    try {
      act(() => { view.result.current[1](value); });
      const first = view.result.current[3].selectedKey!;
      act(() => { view.result.current[1](value); });
      const second = view.result.current[3].selectedKey!;
      expect(second).not.toBe(first);
      act(() => { view.result.current[3].select(first); });
      const selected = view.result.current[0]!;
      act(() => { view.result.current[1](null, 'doc-1', selected); });
      expect(readDraft(first)).toBeNull();
      expect(readDraft(second)?.value).toEqual(value);
    } finally { view.unmount(); }
  });

  it('keeps an already shown missing-key copy selectable without recreating its stored entry', () => {
    const first = { payload: { title: 'Already shown first words' }, actualRevision: 1 };
    const second = { payload: { title: 'Another retained choice' }, actualRevision: 2 };
    const firstKey = draftKey('u1', 'doc-1', 'conflict:meta');
    const secondKey = draftKey('u1', 'doc-1', 'conflict:meta', 'second');
    saveDraft(firstKey, first); saveDraft(secondKey, second);
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    try {
      expect(view.result.current[0]).toEqual(first);
      localStorage.removeItem(firstKey);
      act(() => { window.dispatchEvent(new StorageEvent('storage', { key: firstKey })); });
      expect(view.result.current[0]).toEqual(first);
      act(() => { view.result.current[3].select(secondKey); });
      const selected = view.result.current[0]!;
      act(() => { view.result.current[1](null, 'doc-1', selected); });
      expect(view.result.current[0]).toEqual(first);
      expect(findDraftCopies('u1', 'doc-1', 'conflict:meta')).toEqual([]);
    } finally { view.unmount(); }
  });

  it('replaces only an explicitly selected copy and retains an independent alternative', () => {
    const first = { payload: { title: 'First choice' }, actualRevision: 1 };
    const other = { payload: { title: 'Other choice' }, actualRevision: 2 };
    saveDraft(draftKey('u1', 'doc-1', 'conflict:meta'), first);
    saveDraft(draftKey('u1', 'doc-1', 'conflict:meta', 'other'), other);
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    for (let index = 0; index < 3; index += 1) {
      const held = view.result.current[0]!;
      act(() => { view.result.current[1]({ payload: { title: `Edited choice ${index}` }, actualRevision: 3 }, 'doc-1', held); });
      expect(view.result.current[3].copies).toHaveLength(2);
      expect(view.result.current[3].copies.some(copy => copy.value.payload.title === 'Other choice')).toBe(true);
    }
    view.unmount();
  });

  it('lets the person select a physical choice even when both payloads have equal words', () => {
    const value = { payload: { title: 'Same words' }, actualRevision: 1 };
    const first = draftKey('u1', 'doc-1', 'conflict:meta');
    const second = draftKey('u1', 'doc-1', 'conflict:meta', 'other');
    saveDraft(first, value); saveDraft(second, value);
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => { view.result.current[3].select(second); });
    const selected = view.result.current[0]!;
    expect(view.result.current[3].selectedKey).toBe(second);
    act(() => { view.result.current[1](null, 'doc-1', selected); });
    expect(findDraftCopies('u1', 'doc-1', 'conflict:meta').map(copy => copy.key)).toEqual([first]);
    expect(view.result.current[3].selectedKey).toBe(first);
    view.unmount();
  });

  it('does not resolve a later refusal when an earlier same-document answer arrives', () => {
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => { view.result.current[1]({ payload: { title: 'First choice' }, actualRevision: 1 }); });
    const captured = view.result.current[0]!;
    act(() => { view.result.current[1]({ payload: { title: 'Later choice' }, actualRevision: 2 }); });
    act(() => { view.result.current[1](null, 'doc-1', captured); });
    expect(view.result.current[0]?.payload.title).toBe('Later choice');
    expect(findDraftCopies('u1', 'doc-1', 'conflict:meta').map(copy => copy.value)).toEqual([{ payload: { title: 'Later choice' }, actualRevision: 2 }]);
    view.unmount();
  });

  it('keeps stored words and only the latest edited transient copy while storage refuses a replacement', () => {
    const original = { payload: { title: 'Stored original' }, actualRevision: 1 };
    const key = draftKey('u1', 'doc-1', 'conflict:meta'); saveDraft(key, original);
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    try {
      for (let index = 0; index < 3; index += 1) {
        const held = view.result.current[0]!;
        act(() => { view.result.current[1]({ payload: { title: `Unstored edit ${index}` }, actualRevision: 1 }, 'doc-1', held); });
      }
      expect(view.result.current[0]?.payload.title).toBe('Unstored edit 2');
      expect(findDraftCopies('u1', 'doc-1', 'conflict:meta').map(copy => copy.value)).toEqual([original]);
      expect(view.result.current[3].copies).toHaveLength(2);
    } finally {
      setItem.mockRestore();
      for (const copy of [...view.result.current[3].copies]) act(() => { view.result.current[1](null, 'doc-1', copy.value); });
      view.unmount();
    }
  });

  it('refuses to replace a choice under a different document identity', () => {
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => { view.result.current[1]({ payload: { title: 'First choice' }, actualRevision: 1 }); });
    const captured = view.result.current[0]!;
    act(() => { view.result.current[1]({ payload: { title: 'Mismatched edit' }, actualRevision: 2 }, 'doc-2', captured); });
    expect(findDraftCopies('u1', 'doc-2', 'conflict:meta')).toEqual([]);
    expect(view.result.current[0]?.payload.title).toBe('First choice');
    view.unmount();
  });

  it('keeps both independently refused values of one document after reload', () => {
    const first = { payload: { title: 'First refused words' }, actualRevision: 1 };
    const second = { payload: { title: 'Second refused words' }, actualRevision: 2 };
    const openingA = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => { openingA.result.current[1](first); });
    openingA.unmount();
    const openingB = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => { openingB.result.current[1](second); });
    openingB.unmount();
    expect(new Set(findDraftCopies('u1', 'doc-1', 'conflict:meta').map(copy => JSON.stringify(copy.value))))
      .toEqual(new Set([JSON.stringify(first), JSON.stringify(second)]));
  });

  it('keeps separately refused attempts from the same opening instead of replacing the earlier value', () => {
    const first = { payload: { title: 'First attempted words' }, actualRevision: 1 };
    const second = { payload: { title: 'Second attempted words' }, actualRevision: 2 };
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    act(() => { view.result.current[1](first); });
    act(() => { view.result.current[1](second); });
    view.unmount();
    expect(new Set(findDraftCopies('u1', 'doc-1', 'conflict:meta').map(copy => JSON.stringify(copy.value))))
      .toEqual(new Set([JSON.stringify(first), JSON.stringify(second)]));
  });

  it('reveals the next same-document alternative after resolving the shown legacy copy', () => {
    const first = { payload: { title: 'First retained choice' }, actualRevision: 1 };
    const second = { payload: { title: 'Second retained choice' }, actualRevision: 2 };
    const legacy = draftKey('u1', 'doc-1', 'conflict:meta');
    const scoped = draftKey('u1', 'doc-1', 'conflict:meta', 'other-opening');
    saveDraft(legacy, first); saveDraft(scoped, second);
    const view = renderHook(() => usePersistedConflict<{ title: string }>('u1', 'doc-1', 'meta'));
    try {
      expect(view.result.current[0]).toEqual(first);
      act(() => { view.result.current[1](null); });
      expect(view.result.current[0]).toEqual(second);
      expect(findDraftCopies('u1', 'doc-1', 'conflict:meta').map(copy => copy.key)).toEqual([scoped]);
    } finally { view.unmount(); }
  });

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
  it('stores a late refusal for its own document without publishing it over the current document', () => {
    const view=renderHook(({id}) => usePersistedConflict<{title:string}>('u1',id,'meta'),{initialProps:{id:'a'}});
    const late=view.result.current[1];
    view.rerender({id:'b'});
    act(() => view.result.current[1]({payload:{title:'Current B'},actualRevision:2}));
    act(() => late({payload:{title:'Late A'},actualRevision:1},'a'));
    expect(view.result.current[0]?.payload.title).toBe('Current B');
    view.rerender({id:'a'});
    expect(view.result.current[0]?.payload.title).toBe('Late A');
  });

});
