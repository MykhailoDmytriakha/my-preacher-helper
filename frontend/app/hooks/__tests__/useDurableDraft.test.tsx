import { act, renderHook } from '@testing-library/react';

import { useDurableDraft, type UseDurableDraftOptions } from '@/hooks/useDurableDraft';
import { draftKey, moveDraft, readDraft, retireDraftCapture, saveDraft } from '@/utils/durableDraft';

const KEY = draftKey('uid-1', 'note-1', 'note');

function render(value: string, overrides: Partial<UseDurableDraftOptions<string>> = {}) {
  return renderHook(
    (props: { value: string }) =>
      useDurableDraft<string>({
        uid: 'uid-1',
        docId: 'note-1',
        aggregate: 'note',
        enabled: true,
        ...overrides,
        value: props.value,
      }),
    { initialProps: { value } }
  );
}

describe('useDurableDraft', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['server acceptance', 'explicit capture', 'capture event'] as const)(
    'keeps an unselected equal-value physical copy after %s of the adopted copy', mode => {
      const adoptedKey = draftKey('uid-1', 'note-1', 'note', 'earlier-opening');
      const otherKey = draftKey('uid-1', 'note-1', 'note', 'independent-opening');
      const currentKey = draftKey('uid-1', 'note-1', 'note', 'current-opening');
      saveDraft(adoptedKey, 'Same retained words');
      saveDraft(otherKey, 'Same retained words');
      const otherRaw = localStorage.getItem(otherKey);
      const view = render('Original words', { writerId: 'current-opening' });
      act(() => view.result.current.selectRecovered(adoptedKey));
      act(() => view.result.current.acceptRecovered());
      if (mode === 'server acceptance') act(() => view.result.current.markSaved('Same retained words'));
      else if (mode === 'explicit capture') act(() => view.result.current.markCaptured('Same retained words', 'note-1'));
      else {
        saveDraft(currentKey, 'Same retained words', undefined, true);
        const token = readDraft<string>(currentKey)!.captureToken!;
        act(() => { expect(retireDraftCapture(currentKey, token, 'Same retained words')).toBe(true); });
      }
      expect(readDraft(adoptedKey)).toBeNull();
      expect(localStorage.getItem(otherKey)).toBe(otherRaw);
      expect(view.result.current.recoveries.map(copy => copy.key)).toEqual([otherKey]);
      view.unmount();
    }
  );

  it.each(['server acceptance', 'explicit capture', 'capture event'] as const)(
    'keeps equal-value offers without source adoption after %s of the current writer', mode => {
      const firstKey = draftKey('uid-1', 'note-1', 'note');
      const secondKey = draftKey('uid-1', 'note-1', 'note', 'independent-opening');
      const currentKey = draftKey('uid-1', 'note-1', 'note', 'current-opening');
      saveDraft(firstKey, 'Same retained words'); saveDraft(secondKey, 'Same retained words');
      const raws = [localStorage.getItem(firstKey), localStorage.getItem(secondKey)];
      const view = render('Original words', { writerId: 'current-opening' });
      if (mode === 'server acceptance') act(() => view.result.current.markSaved('Same retained words'));
      else if (mode === 'explicit capture') act(() => view.result.current.markCaptured('Same retained words', 'note-1'));
      else {
        saveDraft(currentKey, 'Same retained words', undefined, true);
        act(() => { expect(retireDraftCapture(currentKey, readDraft<string>(currentKey)!.captureToken!, 'Same retained words')).toBe(true); });
      }
      expect([localStorage.getItem(firstKey), localStorage.getItem(secondKey)]).toEqual(raws);
      expect(view.result.current.recoveries).toHaveLength(2);
      view.unmount();
    }
  );

  it('keeps a replaced adopted record with equal words after the earlier record is accepted', () => {
    const key = draftKey('uid-1', 'note-1', 'note', 'earlier-opening');
    saveDraft(key, 'Same retained words');
    const view = render('Original words', { writerId: 'current-opening' });
    act(() => view.result.current.acceptRecovered());
    act(() => jest.advanceTimersByTime(1));
    saveDraft(key, 'Same retained words');
    const replacement = localStorage.getItem(key);
    act(() => view.result.current.markSaved('Same retained words'));
    expect(localStorage.getItem(key)).toBe(replacement);
    view.unmount();
  });

  it('retires only the adopted scoped source when restored text returns to baseline', () => {
    const adoptedKey = draftKey('uid-1', 'note-1', 'note', 'earlier-opening');
    const siblingKey = draftKey('uid-1', 'note-1', 'note', 'independent-opening');
    saveDraft(adoptedKey, 'Same retained words');
    saveDraft(siblingKey, 'Same retained words');
    const siblingRaw = localStorage.getItem(siblingKey);
    const view = render('Server baseline', { writerId: 'current-opening' });

    act(() => view.result.current.selectRecovered(adoptedKey));
    act(() => view.result.current.acceptRecovered());
    view.rerender({ value: 'Same retained words' });
    view.rerender({ value: 'Server baseline' });
    act(() => jest.advanceTimersByTime(300));

    expect(readDraft(adoptedKey)).toBeNull();
    expect(localStorage.getItem(siblingKey)).toBe(siblingRaw);
    expect(view.result.current.recoveries.map(copy => copy.key)).toEqual([siblingKey]);
    view.unmount();
  });

  it('keeps an adopted scoped source record replaced before baseline return', () => {
    const sourceKey = draftKey('uid-1', 'note-1', 'note', 'earlier-opening');
    saveDraft(sourceKey, 'Same retained words');
    const view = render('Server baseline', { writerId: 'current-opening' });

    act(() => view.result.current.acceptRecovered());
    act(() => jest.advanceTimersByTime(1));
    saveDraft(sourceKey, 'Same retained words');
    const replacement = localStorage.getItem(sourceKey);
    view.rerender({ value: 'Same retained words' });
    view.rerender({ value: 'Server baseline' });
    act(() => jest.advanceTimersByTime(300));

    expect(localStorage.getItem(sourceKey)).toBe(replacement);
    view.unmount();
  });

  it('does not let a late capture from the previous owner replace the current handoff proof', () => {
    const view = renderHook(({ uid, value }) => useDurableDraft({ uid, docId: 'note-1', aggregate: 'note',
      value, enabled: true, confirmedValue: 'Confirmed original' }),
      { initialProps: { uid: 'uid-1', value: 'First owner words' } });
    act(() => { jest.advanceTimersByTime(300); });
    const oldCapture = view.result.current.markCaptured;
    view.rerender({ uid: 'uid-2', value: 'Second owner words' });
    act(() => { jest.advanceTimersByTime(300); });
    act(() => { view.result.current.markCaptured('Second owner words', 'note-1'); });
    const secondKey = draftKey('uid-2', 'note-1', 'note');
    expect(readDraft(secondKey)).toBeNull();
    act(() => { oldCapture('First owner words', 'note-1'); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(readDraft(secondKey)).toBeNull();
    expect(readDraft(KEY)).toBeNull();
    view.unmount();
  });

  it('keeps later words when the older payload is transferred to a canonical request', () => {
    const view = render('Confirmed original');
    view.rerender({ value: 'Submitted first' });
    act(() => { jest.advanceTimersByTime(300); });
    view.rerender({ value: 'Later unsent words' });
    act(() => { jest.advanceTimersByTime(300); });
    act(() => { view.result.current.markCaptured('Submitted first', 'note-1'); });
    expect(readDraft(KEY)?.value).toBe('Later unsent words');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(readDraft(KEY)?.value).toBe('Later unsent words');
    view.unmount();
    expect(readDraft(KEY)?.value).toBe('Later unsent words');
  });

  it.each([undefined, 'another-creation'])('keeps a source tagged %s when a different reserved destination takes ownership', tag => {
    const source = draftKey('uid-1', 'new', 'note');
    const target = draftKey('uid-1', 'reserved-note', 'note');
    saveDraft(source, 'Same words', tag); saveDraft(target, 'Same words');
    const original = localStorage.getItem(source);
    const view = render('Same words', { docId: 'new', creationTargetId: 'reserved-note', confirmedValue: null });
    act(() => { view.result.current.markCaptured('Same words', 'reserved-note'); });
    expect(readDraft(target)).toBeNull();
    act(() => { jest.advanceTimersByTime(300); window.dispatchEvent(new Event('pagehide')); });
    view.unmount();
    expect(localStorage.getItem(source)).toBe(original);
  });

  it('persists an edit once typing settles', () => {
    const { rerender } = render('server text');
    rerender({ value: 'server text + typed' });

    expect(readDraft(KEY)).toBeNull(); // debounced, not written yet
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(readDraft<string>(KEY)?.value).toBe('server text + typed');
  });

  it('persists on pagehide BEFORE the debounce fires — the closed-tab case', () => {
    // This is the loss the study note editor has today: its autosave cancels the
    // pending save on cleanup, so text typed within the debounce window dies with
    // the page. The draft must already be on disk at that moment.
    const { rerender } = render('server text');
    rerender({ value: 'text typed a moment ago' });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(readDraft<string>(KEY)?.value).toBe('text typed a moment ago');
  });

  it('persists when the tab is backgrounded without unloading', () => {
    const { rerender } = render('server text');
    rerender({ value: 'mobile app switch' });

    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(readDraft<string>(KEY)?.value).toBe('mobile app switch');
  });

  it('persists on unmount — navigating away within the debounce window', () => {
    const { rerender, unmount } = render('server text');
    rerender({ value: 'half a sentence' });

    act(() => {
      unmount();
    });

    expect(readDraft<string>(KEY)?.value).toBe('half a sentence');
  });

  it('writes nothing while the editor is still initialising', () => {
    render('placeholder', { enabled: false });

    act(() => {
      jest.advanceTimersByTime(300);
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(readDraft(KEY)).toBeNull();
  });

  it('writes nothing without an owner, so no draft lands under an unsafe key', () => {
    render('text', { uid: null });

    act(() => {
      jest.advanceTimersByTime(300);
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(window.localStorage.length).toBe(0);
  });

  it('surfaces unconfirmed text found at open', () => {
    saveDraft(KEY, 'text from a previous session');

    const { result } = render('loaded from server');

    expect(result.current.recovered).toBe('text from a previous session');
  });

  it('does not re-surface the draft while the user keeps typing', () => {
    saveDraft(KEY, 'text from a previous session');
    const { result, rerender } = render('loaded from server');

    act(() => {
      result.current.discardRecovered();
    });
    rerender({ value: 'now typing something new' });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.recovered).toBeNull();
  });

  it('retires the draft once the server confirms that exact value', () => {
    const { result } = render('confirmed text');
    act(() => {
      jest.advanceTimersByTime(300);
    });

    act(() => {
      result.current.markSaved('confirmed text');
    });

    expect(readDraft(KEY)).toBeNull();
  });

  it('retires a matching recovered offer after confirmation, including reordered fields', () => {
    const original = { text: 'saved text', refs: [{ book: 'Psalms', verse: 5 }] };
    saveDraft(KEY, original);
    const { result, rerender } = renderHook(({ value }) => useDurableDraft({
      uid: 'uid-1', docId: 'note-1', aggregate: 'note', enabled: true, value,
    }), { initialProps: { value: original } });
    expect(result.current.recovered).toEqual(original);
    act(() => result.current.markSaved({ refs: [{ verse: 5, book: 'Psalms' }], text: 'saved text' }));
    rerender({ value: { ...original, text: 'next edit' } });
    act(() => jest.advanceTimersByTime(300));
    expect(result.current.recovered).toBeNull();
    expect(readDraft(KEY)?.value).toEqual({ ...original, text: 'next edit' });
  });

  it('keeps a different recovered offer when another value is confirmed', () => {
    saveDraft(KEY, 'unconfirmed recovery');
    const { result } = render('server text');
    act(() => result.current.markSaved('server text'));
    expect(result.current.recovered).toBe('unconfirmed recovery');
    expect(readDraft(KEY)?.value).toBe('unconfirmed recovery');
  });

  it('keeps later typing durable while an optimistic create receives its real id', () => {
    const { result, rerender } = renderHook(({ docId, value, confirmedValue }) => useDurableDraft({
      uid: 'uid-1', docId, aggregate: 'note', enabled: true, value, confirmedValue,
    }), { initialProps: { docId: 'new', value: 'create A', confirmedValue: '' } });
    rerender({ docId: 'note-1', value: 'later B', confirmedValue: '' });
    act(() => jest.advanceTimersByTime(300));
    expect(readDraft(KEY)?.value).toBe('later B');
    act(() => result.current.markSaved('create A'));
    rerender({ docId: 'note-1', value: 'later B', confirmedValue: 'create A' });
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(readDraft(KEY)?.value).toBe('later B');
  });

  it('does not offer its own carried draft as recovery when a create adopts its id', () => {
    const { result, rerender, unmount } = renderHook(({ docId, value }) => useDurableDraft({
      uid: 'uid-1', docId, recoveryIdentity: 'new', aggregate: 'note', enabled: true, value, confirmedValue: '',
    }), { initialProps: { docId: 'new', value: 'Create A' } });
    act(() => jest.advanceTimersByTime(300));
    moveDraft(draftKey('uid-1', 'new', 'note'), KEY);
    rerender({ docId: 'note-1', value: 'Later B' });
    expect(result.current.recovered).toBeNull();
    act(() => jest.advanceTimersByTime(300));
    expect(readDraft(KEY)?.value).toBe('Later B');
    unmount();
    const reopened = render('server value');
    expect(reopened.result.current.recovered).toBe('Later B');
  });

  it('preserves a genuine opening recovery offer across id adoption', () => {
    const temporaryKey = draftKey('uid-1', 'new', 'note');
    saveDraft(temporaryKey, 'Previous session');
    const { result, rerender } = renderHook(({ docId }) => useDurableDraft({
      uid: 'uid-1', docId, recoveryIdentity: 'new', aggregate: 'note', enabled: true,
      value: 'Current session', confirmedValue: '',
    }), { initialProps: { docId: 'new' } });
    expect(result.current.recovered).toBe('Previous session');
    moveDraft(temporaryKey, KEY);
    rerender({ docId: 'note-1' });
    expect(result.current.recovered).toBe('Previous session');
  });

  it('keeps a draft the server never confirmed', () => {
    const { result, rerender } = render('server text');
    rerender({ value: 'newer text' });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    act(() => {
      result.current.markSaved('older text saved elsewhere');
    });

    expect(readDraft<string>(KEY)?.value).toBe('newer text');
  });

  it('leaves NO draft behind when the document was only visited, not edited', () => {
    // Found in live use: flushing unconditionally stored a draft on every
    // navigation. Harmless-looking (it equals the content, so no banner) until
    // the same document is edited on another device — then the leftover differs
    // from the fresh server text and the editor offers to restore OLD over NEW.
    const { unmount } = render('text exactly as the server has it');

    act(() => {
      jest.advanceTimersByTime(300);
      window.dispatchEvent(new Event('pagehide'));
      unmount();
    });

    expect(readDraft(KEY)).toBeNull();
  });

  it('retires a draft once the editor text returns to the confirmed value', () => {
    const { result, rerender } = render('server text');
    rerender({ value: 'server text plus an edit' });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(readDraft<string>(KEY)?.value).toBe('server text plus an edit');

    rerender({ value: 'server text' }); // undone by hand
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(readDraft(KEY)).toBeNull();
    expect(result.current.recovered).toBeNull();
  });

  it('discarding the offer KEEPS text typed after it appeared', () => {
    // The offer sits on screen while the person keeps working. Rejecting the OLD
    // recovered text must not delete what they have written since — that would be
    // a loss of unconfirmed text disguised as a dismissal.
    saveDraft(KEY, 'abandoned text');
    const { result, rerender } = render('loaded from server');
    expect(result.current.recovered).toBe('abandoned text');

    rerender({ value: 'what the person is writing now' });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    act(() => {
      result.current.discardRecovered();
    });

    expect(result.current.recovered).toBeNull();
    expect(readDraft<string>(KEY)?.value).toBe('what the person is writing now');
  });

  it('retires a restored copy once the editor comes back to the server value before writing its own', () => {
    // Restored, then within the write delay the window took the other device's version — the server's value. The copy
    // the person let go must not be offered again (Codex review, 2026-10-28).
    saveDraft(KEY, 'restored text');
    const { result, rerender } = render('server value');
    act(() => {
      result.current.acceptRecovered();
    });
    rerender({ value: 'restored text' });
    rerender({ value: 'server value' });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(readDraft(KEY)).toBeNull();
  });

  it('keeps a restored copy while the editor still shows it', () => {
    saveDraft(KEY, 'restored text');
    const { result, rerender } = render('server value');
    act(() => {
      result.current.acceptRecovered();
    });
    rerender({ value: 'restored text' });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(readDraft<string>(KEY)?.value).toBe('restored text');
  });

  it('discarding removes the stored draft, not just the banner', () => {
    saveDraft(KEY, 'abandoned text');
    const { result } = render('loaded from server');

    act(() => {
      result.current.discardRecovered();
    });

    expect(readDraft(KEY)).toBeNull();
    expect(result.current.recovered).toBeNull();
  });
});

describe('a recovered draft must survive until the user decides', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('does NOT delete the found draft while the banner is still on screen', () => {
    // The editor opens showing the SERVER value, which is also the baseline. If
    // "value equals baseline" is treated as "retire the draft", the unconfirmed
    // text found at open is destroyed ~250ms later — while the user is still
    // looking at the offer to restore it. The in-memory copy hides this until a
    // reload, and then there is nothing left to restore.
    saveDraft(KEY, 'text that never reached the server');

    const { result } = render('server value');
    expect(result.current.recovered).toBe('text that never reached the server');

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(readDraft<string>(KEY)?.value).toBe('text that never reached the server');
  });

  it('does NOT delete a draft written by ANOTHER tab', () => {
    // This tab is untouched (value === baseline). Another tab stored unconfirmed
    // text under the shared key. Any flush here must not remove it.
    const { unmount } = render('server value');
    saveDraft(KEY, 'unconfirmed text from the other tab');

    act(() => {
      jest.advanceTimersByTime(1000);
      window.dispatchEvent(new Event('pagehide'));
      unmount();
    });

    expect(readDraft<string>(KEY)?.value).toBe('unconfirmed text from the other tab');
  });
});

// The offline shell keeps the note editor mounted without a sign-in guard, so the account
// can change under it (open: BUG-20261003-account-change-under-open-note). Storing the write
// still waiting at that moment was tried and refused in review: one slot per note means it can
// replace a newer draft another editor left. These lock what must hold meanwhile.
describe('when the account changes under a mounted editor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  type Props = { uid: string | undefined; value: string; confirmedValue?: string };
  const open = (initialProps: Props) =>
    renderHook(
      (props: Props) => useDurableDraft<string>({ docId: 'note-1', aggregate: 'note', enabled: true, ...props }),
      { initialProps }
    );

  it('keeps a newer draft another editor left when this editor\'s owner goes away with a write waiting', () => {
    const older = open({ uid: 'uid-1', value: 'server text', confirmedValue: 'server text' });
    older.rerender({ uid: 'uid-1', value: 'older unsaved text', confirmedValue: 'server text' });
    act(() => jest.advanceTimersByTime(100));
    const newer = open({ uid: 'uid-1', value: 'server text', confirmedValue: 'server text' });
    newer.rerender({ uid: 'uid-1', value: 'newer unsaved text, its only copy', confirmedValue: 'server text' });
    act(() => jest.advanceTimersByTime(51));
    newer.unmount();
    older.rerender({ uid: undefined, value: 'older unsaved text', confirmedValue: 'server text' });
    act(() => jest.advanceTimersByTime(1000));
    older.unmount();

    expect(readDraft<string>(KEY)?.value).toBe('newer unsaved text, its only copy');
  });

  it('leaves no draft of text already saved when the owner signs out afterwards', () => {
    const view = open({ uid: 'uid-1', value: 'server text' });
    view.rerender({ uid: 'uid-1', value: 'saved text' });
    act(() => jest.advanceTimersByTime(300));
    act(() => view.result.current.markSaved('saved text'));
    view.rerender({ uid: undefined, value: 'saved text' });
    act(() => {
      view.unmount();
    });

    expect(readDraft<string>(KEY)).toBeNull();
  });

  it('keeps writing when the same owner comes back after a moment without one', () => {
    const view = open({ uid: 'uid-1', value: 'server text' });
    view.rerender({ uid: undefined, value: 'server text' });
    view.rerender({ uid: 'uid-1', value: 'typed after the owner came back' });
    act(() => jest.advanceTimersByTime(300));

    expect(readDraft<string>(KEY)?.value).toBe('typed after the owner came back');
  });
});
