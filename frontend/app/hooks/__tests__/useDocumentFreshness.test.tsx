import { act, renderHook } from '@testing-library/react';

import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';

type Snapshot = {
  metadata: { hasPendingWrites: boolean; fromCache: boolean };
  exists: () => boolean;
  data: () => Record<string, unknown>;
};

let emit: ((snap: Snapshot) => void) | null = null;
let fail: ((error: unknown) => void) | null = null;
const unsubscribe = jest.fn();

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
const getDocFromServer = jest.fn();
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDocFromServer: (...args: unknown[]) => getDocFromServer(...args),
  onSnapshot: (
    _ref: unknown,
    _options: unknown,
    onNext: (snap: Snapshot) => void,
    onError: (e: unknown) => void
  ) => {
    emit = onNext;
    fail = onError;
    return unsubscribe;
  },
}));

const server = (
  data: Record<string, unknown>,
  metadata: Partial<Snapshot['metadata']> = {}
): Snapshot => ({
  metadata: { hasPendingWrites: false, fromCache: false, ...metadata },
  exists: () => true,
  data: () => data,
});

function render(
  known: { title: string } | null,
  enabled = true,
  adoptFirstServerAnswerAsKnown = false
) {
  return renderHook(
    (props: { known: { title: string } | null }) =>
      useDocumentFreshness<{ title: string }>({
        collection: 'studyNotes',
        docId: 'note-1',
        uid: 'uid-1',
        enabled,
        known: props.known,
        adoptFirstServerAnswerAsKnown,
        select: (data) => ({ title: (data.title as string) || '' }),
      }),
    { initialProps: { known } }
  );
}

describe('useDocumentFreshness', () => {
  beforeEach(() => {
    emit = null;
    fail = null;
    unsubscribe.mockClear();
  });

  it('stays SILENT before the server answers — a cold start is not a warning', () => {
    // Internally this moment is "unknown", and it is reported as `fresh` on
    // purpose: every page open passes through it, so warning here would put an
    // amber pill on every screen for a split second. A person who learns to
    // ignore that pill will also ignore the one that matters. Genuine "I cannot
    // tell" — a cache-only snapshot or a dead listener — is still reported.
    const { result } = render({ title: 'local' });
    expect(result.current.state).toBe('fresh');
  });

  it('reports stale when the server holds something the editor has not seen', () => {
    const { result } = render({ title: 'what we know' });

    act(() => emit!(server({ title: 'edited on the phone' })));

    expect(result.current.state).toBe('stale');
    expect(result.current.remote).toEqual({ title: 'edited on the phone' });
  });

  it('reports fresh when the server matches what the editor already knows', () => {
    const { result } = render({ title: 'same' });

    act(() => emit!(server({ title: 'same' })));

    expect(result.current.state).toBe('fresh');
    expect(result.current.remote).toBeNull();
  });

  it('IGNORES our own pending write — an autosave must not raise the banner', () => {
    const { result } = render({ title: 'what we know' });

    act(() => emit!(server({ title: 'what we just typed' }, { hasPendingWrites: true })));

    // Our own write is not news from anywhere, so nothing changes: the hook stays
    // in its pre-answer silence and the banner never appears.
    expect(result.current.state).toBe('fresh');
    expect(result.current.remote).toBeNull();
  });

  /**
   * BUG-20260814-freshness-pill-flashes-on-every-reload.
   *
   * With local persistence Firestore ALWAYS emits its own IndexedDB copy first and
   * the server snapshot ~100 ms later, so this is what EVERY page load looks like.
   * Counting the cached emission as "the listener answered" lifted the cold-start
   * suppression and flashed the amber "freshness unknown" pill on every reload —
   * measured on production at 1414 ms → 1595 ms, and locally 2343 ms → 2429 ms.
   *
   * Internally the state is still `unknown`; what must not happen is REPORTING it
   * while the server has never yet spoken in this session.
   */
  it('stays SILENT on the cache-first emission every reload begins with', () => {
    const { result } = render({ title: 'what we know' });

    act(() => emit!(server({ title: 'anything' }, { fromCache: true })));

    expect(result.current.state).toBe('fresh');
  });

  it('reports the server answer that follows the cached one, as usual', () => {
    // Suppressing the cached emission must not swallow what comes right after it.
    const { result } = render({ title: 'what we know' });

    act(() => emit!(server({ title: 'what we know' }, { fromCache: true })));
    act(() => emit!(server({ title: 'edited on the phone' })));

    expect(result.current.state).toBe('stale');
    expect(result.current.remote).toEqual({ title: 'edited on the phone' });
  });

  it('still admits "unknown" when the cached emission is ALL we ever get', () => {
    // The suppression is a blink, not a blindfold: if the server never answers, the
    // grace timer must still turn the silence into the honest warning.
    jest.useFakeTimers();
    try {
      const { result } = render({ title: 'what we know' });
      act(() => emit!(server({ title: 'anything' }, { fromCache: true })));
      expect(result.current.state).toBe('fresh');

      act(() => {
        jest.advanceTimersByTime(20_000);
      });

      expect(result.current.state).toBe('unknown');
    } finally {
      jest.useRealTimers();
    }
  });

  it('flags a document deleted on another device', () => {
    const { result } = render({ title: 'still open here' });

    act(() =>
      emit!({
        metadata: { hasPendingWrites: false, fromCache: false },
        exists: () => false,
        data: () => ({}),
      })
    );

    expect(result.current.remotelyDeleted).toBe(true);
    expect(result.current.state).toBe('stale');
  });

  it('falls back to unknown when the listener dies — never silently back to green', () => {
    const { result } = render({ title: 'known' });
    act(() => emit!(server({ title: 'known' })));
    expect(result.current.state).toBe('fresh');

    act(() => fail!(new Error('permission-denied')));

    expect(result.current.state).toBe('unknown');
  });

  it('clears the flag once the caller confirms it took the newer value', () => {
    const { result } = render({ title: 'old' });
    act(() => emit!(server({ title: 'new' })));
    expect(result.current.state).toBe('stale');

    act(() => result.current.markSynced({ title: 'new' }));

    expect(result.current.state).toBe('fresh');
    expect(result.current.remote).toBeNull();
  });

  it('keeps warning when the caller reports something OTHER than the server value', () => {
    // The person took the remote text, and while they were doing it a THIRD edit
    // landed from the other device. Reporting what they took must not silence the
    // warning about the version they have never seen.
    const { result } = render({ title: 'old' });
    act(() => emit!(server({ title: 'second device' })));
    act(() => emit!(server({ title: 'third edit' })));
    expect(result.current.state).toBe('stale');

    act(() => result.current.markSynced({ title: 'second device' }));

    expect(result.current.state).toBe('stale');
    expect(result.current.remote).toEqual({ title: 'third edit' });
  });

  it('detaches the listener when the editor goes away', () => {
    const { unmount } = render({ title: 'x' });
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('never attaches a listener without a signed-in owner', () => {
    renderHook(() =>
      useDocumentFreshness<{ title: string }>({
        collection: 'studyNotes',
        docId: 'note-1',
        uid: null,
        enabled: true,
        known: { title: 'x' },
        select: (data) => ({ title: (data.title as string) || '' }),
      })
    );

    expect(emit).toBeNull();
  });
});

describe('a cache-only snapshot must never leave a stale "fresh" standing', () => {
  it('drops back to unknown when the next emission comes from cache', () => {
    // Proving freshness once does not prove it forever: the connection may have
    // dropped since. Keeping "fresh" here is exactly the lie this state prevents.
    const { result } = render({ title: 'known' });
    act(() => emit!(server({ title: 'known' })));
    expect(result.current.state).toBe('fresh');

    act(() => emit!(server({ title: 'known' }, { fromCache: true })));

    expect(result.current.state).toBe('unknown');
  });

  it('admits "unknown" once the silence is long enough to mean something', () => {
    // Suppressing the cold start is right; claiming FRESH for an hours-long
    // disconnected session is not. The listener never answers when the connection
    // is down, so silence itself has to become news.
    jest.useFakeTimers();
    try {
      const { result } = render({ title: 'local' });
      expect(result.current.state).toBe('fresh');

      act(() => {
        jest.advanceTimersByTime(20_000);
      });

      expect(result.current.state).toBe('unknown');
    } finally {
      jest.useRealTimers();
    }
  });

  it('says "unknown" immediately when the browser itself reports no connection', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    try {
      const { result } = render({ title: 'local' });
      expect(result.current.state).toBe('unknown');
    } finally {
      delete (window.navigator as unknown as Record<string, unknown>).onLine;
    }
  });

});

/**
 * A dead connection is SILENT, and so is a healthy idle one. The difference is
 * what happens when the person comes back to the tab — which, for someone who
 * works on a laptop and continues on a phone, is precisely the moment that matters.
 */
describe('coming back to the tab re-checks a proof that has gone old', () => {
  const realNow = Date.now;

  beforeEach(() => {
    getDocFromServer.mockReset();
  });

  afterEach(() => {
    Date.now = realNow;
  });

  const returnToTab = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };

  it('asks the server and reports the newer version found there', async () => {
    const { result } = render({ title: 'what the laptop showed' });
    act(() => emit!(server({ title: 'what the laptop showed' })));
    expect(result.current.state).toBe('fresh');

    // Two hours pass with the lid closed: no snapshot, no error, nothing.
    Date.now = () => realNow() + 2 * 60 * 60 * 1000;
    getDocFromServer.mockResolvedValue({
      exists: () => true,
      data: () => ({ title: 'rewritten on the phone' }),
    });

    returnToTab();
    await act(async () => {
      await Promise.resolve();
    });

    expect(getDocFromServer).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('stale');
    expect(result.current.remote).toEqual({ title: 'rewritten on the phone' });
  });

  it('says unknown when the server cannot be reached on a deliberate ask', async () => {
    const { result } = render({ title: 'x' });
    act(() => emit!(server({ title: 'x' })));
    expect(result.current.state).toBe('fresh');

    Date.now = () => realNow() + 10 * 60 * 1000;
    getDocFromServer.mockRejectedValue(new Error('client is offline'));

    returnToTab();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state).toBe('unknown');
  });

  it('does NOT spend a read when the proof is still fresh', () => {
    render({ title: 'x' });
    act(() => emit!(server({ title: 'x' })));

    returnToTab();

    expect(getDocFromServer).not.toHaveBeenCalled();
  });

  it('reports unknown the moment the browser says the connection dropped', () => {
    const { result } = render({ title: 'x' });
    act(() => emit!(server({ title: 'x' })));
    expect(result.current.state).toBe('fresh');

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.state).toBe('unknown');
  });
});

/**
 * Moving between documents re-runs the listener effect but used to leave the old
 * document's answers in place — so B asserted "fresh" about something nothing had
 * ever said anything about.
 */
describe('a new document starts from knowing nothing', () => {
  it('does not inherit the previous document\'s "fresh"', () => {
    const { result, rerender } = renderHook(
      ({ docId }: { docId: string }) =>
        useDocumentFreshness<{ title: string }>({
          collection: 'studyNotes',
          docId,
          uid: 'u1',
          enabled: true,
          known: { title: 'whatever' },
          select: (data) => ({ title: (data.title as string) || '' }),
        }),
      { initialProps: { docId: 'doc-A' } }
    );

    // A ends up STALE: the server holds something the editor does not.
    act(() => emit!(server({ title: 'changed on another device' })));
    expect(result.current.state).toBe('stale');
    expect(result.current.remote).toEqual({ title: 'changed on another device' });

    // Move to B. Nothing has answered for B yet — so B must not present A's
    // newer-version offer as its own.
    rerender({ docId: 'doc-B' });

    expect(result.current.remote).toBeNull();
    expect(result.current.state).not.toBe('stale');
  });

  /**
   * A SCREEN THAT DOES NOT HOLD THE DOCUMENT STILL HAS TO KNOW IT WENT STALE.
   *
   * The settings page has no copy of the settings document — its toggles fetch their
   * own field — so it had nothing to pass as `known`, and passing the hook's own
   * `remote` back to it was a closed loop: `remote` is only filled once the state is
   * already `stale`, which can never happen while `known` is null. Live validation
   * found the pill was simply dead: a preference flipped on the phone produced
   * nothing on screen, while the unit test passed because it mocked the hook.
   *
   * With this option the FIRST server answer is what the screen opened with, and
   * everything after it is news.
   */
  describe('the first server answer can be the baseline', () => {
    it('reports the SECOND, different answer as stale', () => {
      const { result } = render(null, true, true);

      act(() => emit?.(server({ title: 'as opened' })));
      expect(result.current.state).toBe('fresh');

      act(() => emit?.(server({ title: 'changed on the phone' })));
      expect(result.current.state).toBe('stale');
      expect(result.current.remote).toEqual({ title: 'changed on the phone' });
    });

    it('goes quiet again once the screen adopts the newer value', () => {
      const { result } = render(null, true, true);
      act(() => emit?.(server({ title: 'as opened' })));
      act(() => emit?.(server({ title: 'changed on the phone' })));

      act(() => result.current.markSynced({ title: 'changed on the phone' }));

      expect(result.current.state).toBe('fresh');
      // And a THIRD change is news again — the adopted value became the baseline.
      act(() => emit?.(server({ title: 'changed once more' })));
      expect(result.current.state).toBe('stale');
    });

    it('keeps quiet without the option, exactly as before', () => {
      const { result } = render(null, true, false);

      act(() => emit?.(server({ title: 'as opened' })));
      act(() => emit?.(server({ title: 'changed on the phone' })));

      expect(result.current.state).toBe('fresh');
    });
  });

  /**
   * BUG-20260809-false-remote-edit-banner, second half.
   *
   * The comparison lived ONLY inside the snapshot handler: a snapshot arrived, it
   * was compared once. When the screen later caught up — the editor's own write
   * returning with its response — nobody re-compared, and the warning stayed up
   * until the document happened to change again. To the person it looked like the
   * "another device" banner simply never going away, long after the mismatch was
   * gone.
   *
   * Freshness is a relation between TWO values, not an event on one of them.
   */
  describe('when the screen catches up with the server', () => {
    it('clears the warning without waiting for another snapshot', () => {
      const { result, rerender } = render({ title: 'what the screen had' });

      act(() => emit?.(server({ title: 'own write, already on the server' })));
      expect(result.current.state).toBe('stale');

      // The response came back and the screen updated — no mismatch left.
      rerender({ known: { title: 'own write, already on the server' } });

      expect(result.current.state).toBe('fresh');
      expect(result.current.remote).toBeNull();
    });

    it('keeps the warning when the screen caught up to something else', () => {
      const { result, rerender } = render({ title: 'what the screen had' });

      act(() => emit?.(server({ title: 'the server holds something else' })));
      expect(result.current.state).toBe('stale');

      rerender({ known: { title: 'the screen moved, but not that way' } });

      expect(result.current.state).toBe('stale');
    });

    /**
     * A REMEMBERED SERVER VALUE MUST NOT OUTLIVE THE PROOF IT CAME WITH.
     *
     * The recheck compares against what the server last said. If that memory
     * survives into a state where we no longer have server proof — the connection
     * dropped, the listener errored, the document was deleted — then a screen that
     * happens to match the OLD remote would be told "fresh". That is the exact lie
     * this hook exists to prevent: claiming knowledge we no longer have.
     */
    it('does not clear "cannot tell" by matching a value the server said earlier', () => {
      const { result, rerender } = render({ title: 'what the screen had' });

      act(() => emit?.(server({ title: 'the server holds something else' })));
      expect(result.current.state).toBe('stale');

      // The connection drops: a cache-only emission means we can no longer tell.
      act(() => emit?.(server({ title: 'the server holds something else' }, { fromCache: true })));
      expect(result.current.state).toBe('unknown');

      // The screen now happens to match what the server said BEFORE we lost proof.
      rerender({ known: { title: 'the server holds something else' } });

      expect(result.current.state).toBe('unknown');
    });

    it('does not clear a remote deletion by matching the value it used to hold', () => {
      const { result, rerender } = render({ title: 'what the screen had' });

      act(() => emit?.(server({ title: 'still here' })));
      act(() =>
        emit?.({
          metadata: { hasPendingWrites: false, fromCache: false },
          exists: () => false,
          data: () => ({}),
        })
      );
      expect(result.current.state).toBe('stale');
      expect(result.current.remotelyDeleted).toBe(true);

      rerender({ known: { title: 'still here' } });

      expect(result.current.state).toBe('stale');
      expect(result.current.remotelyDeleted).toBe(true);
    });

    it('never raises a warning on its own while the server has said nothing', () => {
      // A cold start is deliberately quiet: "unknown" is suppressed before the first
      // answer so a freshly opened page does not cry wolf. The recheck must not break
      // that — on its own it has no right to raise anything.
      const { result, rerender } = render({ title: 'what the screen had' });

      rerender({ known: { title: 'the person keeps typing' } });

      expect(result.current.state).not.toBe('stale');
      expect(result.current.remote).toBeNull();
    });
  });
});
