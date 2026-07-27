import { act, renderHook } from '@testing-library/react';

import { useDurableDraft } from '@/hooks/useDurableDraft';
import { draftKey, readDraft, saveDraft } from '@/utils/durableDraft';

const KEY = draftKey('uid-1', 'note-1', 'note');

function render(value: string, overrides: Partial<Parameters<typeof useDurableDraft>[0]> = {}) {
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
