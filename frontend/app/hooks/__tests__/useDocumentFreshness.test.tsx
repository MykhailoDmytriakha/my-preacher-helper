import { act, renderHook } from '@testing-library/react';

import { readSermonFromServer } from '@/services/sermonReadFallback.client';

import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';
import {
  planFreshnessProjection,
  type PlanFreshnessProjection,
} from '@/utils/sermonFreshnessProjection';

type Snapshot = {
  metadata: { hasPendingWrites: boolean; fromCache: boolean };
  exists: () => boolean;
  data: () => Record<string, unknown>;
};

let emit: ((snap: Snapshot) => void) | null = null;
let fail: ((error: unknown) => void) | null = null;
const unsubscribe = jest.fn();

jest.mock('@/services/sermonReadFallback.client', () => ({ readSermonFromServer: jest.fn() }));

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

    it('raises and clears for a planText-only change', () => {
      const base = {
        outline: { introduction: [{ id: 'p1', text: 'Point' }], main: [], conclusion: [] },
        thoughts: [],
        plan: { introduction: { outline: '' }, main: { outline: '' }, conclusion: { outline: '' } },
      };
      const oldPlan = planFreshnessProjection({ ...base, planText: { p1: 'Old' } });
      const newPlan = planFreshnessProjection({ ...base, planText: { p1: 'New' } });
      const { result, rerender } = renderHook(
        ({ known }: { known: PlanFreshnessProjection }) =>
          useDocumentFreshness<PlanFreshnessProjection>({
            collection: 'sermons',
            docId: 'sermon-1',
            uid: 'uid-1',
            enabled: true,
            known,
            select: (data) => planFreshnessProjection(data),
          }),
        { initialProps: { known: oldPlan } }
      );

      act(() => emit?.(server({ ...base, planText: { p1: 'New' } })));
      expect(result.current.state).toBe('stale');
      expect(result.current.remote).toEqual(newPlan);

      rerender({ known: newPlan });

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

describe('diagnostic incidents and read-only retry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-05T17:00:00Z'));
    getDocFromServer.mockReset();
    unsubscribe.mockClear();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  afterEach(() => { jest.useRealTimers(); });

  it('distinguishes initial silence from later cache-only data without an idle alarm', () => {
    const { result } = render({ title: 'same' });
    act(() => emit!(server({ title: 'same' }, { fromCache: true })));
    expect(result.current.diagnostics.incident).toBeNull();
    act(() => jest.advanceTimersByTime(15_000));
    expect(result.current.diagnostics.incident?.origin).toMatchObject({ reason: 'initialCheck', source: 'opening' });
    expect(result.current.diagnostics.lastServerResponseAt).toBeNull();
    act(() => emit!(server({ title: 'same' })));
    const at = Date.now();
    act(() => jest.advanceTimersByTime(180_000));
    expect(result.current.state).toBe('fresh');
    act(() => emit!(server({ title: 'same' }, { fromCache: true })));
    act(() => emit!(server({ title: 'same' }, { fromCache: true })));
    expect(result.current.diagnostics.incident?.origin).toEqual({ reason: 'cached', source: 'listener', at: Date.now() });
    expect(result.current.diagnostics.incident?.events).toHaveLength(1);
    expect(result.current.diagnostics.lastServerResponseAt).toBe(at);
  });

  it.each([['permission-denied', 'accessDenied'], ['firestore/unauthenticated', 'accountRequired'],
    ['unavailable', 'listenerStopped'], ['private text!', 'listenerStopped']])(
    'classifies %s without retaining private text', (code, reason) => {
      const { result } = render({ title: 'private text' });
      act(() => fail!({ code, message: 'private error content' }));
      expect(result.current.diagnostics.incident?.origin.reason).toBe(reason);
      expect(JSON.stringify(result.current.diagnostics)).not.toContain('private');
      act(() => jest.advanceTimersByTime(20_000));
      expect(result.current.diagnostics.incident?.events).toHaveLength(1);
    });

  it('preserves the first trigger through retries and bounded history', async () => {
    const { result } = render({ title: 'same' });
    act(() => emit!(server({ title: 'same' })));
    act(() => window.dispatchEvent(new Event('offline')));
    const origin = result.current.diagnostics.incident!.origin;
    getDocFromServer.mockRejectedValue({ code: 'unavailable' });
    for (let i = 0; i < 5; i += 1) await act(async () => { await result.current.checkAgain(); });
    expect(result.current.diagnostics.incident?.origin).toBe(origin);
    expect(result.current.diagnostics.incident?.events).toHaveLength(6);
    expect(result.current.diagnostics.incident?.events.at(-1)).toMatchObject({ reason: 'checkFailed', source: 'manual' });
    expect(result.current.checking).toBe(false);
  });

  it('coalesces return and manual checks without inventing a user action', async () => {
    const { result } = render({ title: 'same' });
    act(() => emit!(server({ title: 'same' })));
    act(() => jest.advanceTimersByTime(180_000));
    let reject!: (error: unknown) => void;
    getDocFromServer.mockReturnValue(new Promise((_, no) => { reject = no; }));
    act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); void result.current.checkAgain(); });
    expect(getDocFromServer).toHaveBeenCalledTimes(1);
    expect(result.current.checking).toBe(true);
    await act(async () => { reject({ code: 'unavailable' }); });
    expect(result.current.diagnostics.incident?.origin).toMatchObject({ reason: 'checkFailed', source: 'return' });
  });

  it('rejects pending local overlays as server proof', async () => {
    const { result } = render({ title: 'known' });
    act(() => emit!(server({ title: 'known' })));
    const proof = result.current.diagnostics.lastServerResponseAt;
    act(() => window.dispatchEvent(new Event('offline')));
    act(() => jest.advanceTimersByTime(1_000));
    getDocFromServer.mockResolvedValue(server({ title: 'pending edit' }, { hasPendingWrites: true }));
    await act(async () => { await result.current.checkAgain(); });
    expect(result.current.state).toBe('unknown');
    expect(result.current.remote).toBeNull();
    expect(result.current.diagnostics.lastServerResponseAt).toBe(proof);
    expect(result.current.diagnostics.incident?.events.at(-1)?.reason).toBe('pendingChanges');
  });

  it('times out a silent check and ignores its late answer', async () => {
    const { result } = render({ title: 'same' });
    act(() => emit!(server({ title: 'same' })));
    let resolve!: (value: Snapshot) => void;
    getDocFromServer.mockReturnValue(new Promise((yes) => { resolve = yes; }));
    act(() => { void result.current.checkAgain(); });
    act(() => jest.advanceTimersByTime(15_000));
    expect(result.current.checking).toBe(false);
    expect(result.current.diagnostics.incident?.origin.reason).toBe('checkTimeout');
    await act(async () => { resolve(server({ title: 'too late' })); });
    expect(result.current.state).toBe('unknown');
    expect(result.current.remote).toBeNull();
  });

  it('keeps a newer server answer when an older read fails', async () => {
    const { result } = render({ title: 'same' });
    let reject!: (error: Error) => void;
    getDocFromServer.mockReturnValue(new Promise((_, no) => { reject = no; }));
    act(() => { void result.current.checkAgain(); });
    act(() => emit!(server({ title: 'same' })));
    await act(async () => { reject(new Error('late failure')); });
    expect(result.current.state).toBe('fresh');
    expect(result.current.checking).toBe(false);
    expect(result.current.diagnostics.incident).toBeNull();
  });

  it('restarts a terminal listener and recovers through a read', async () => {
    const { result } = render({ title: 'same' });
    act(() => fail!({ code: 'unavailable' }));
    const old = emit;
    getDocFromServer.mockResolvedValue(server({ title: 'same' }));
    await act(async () => { await result.current.checkAgain(); });
    expect(emit).not.toBe(old);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.diagnostics.incident).toBeNull();
    expect(result.current.diagnostics.lastServerResult).toBe('matching');
  });

  it('retains previously detected differences after a failure', () => {
    const { result } = render({ title: 'old' });
    act(() => emit!(server({ title: 'new' })));
    act(() => fail!({ code: 'unavailable' }));
    expect(result.current.state).toBe('unknown');
    expect(result.current.diagnostics.lastServerResult).toBe('different');
  });

  it('isolates old responses and history after navigation', async () => {
    const { result, rerender } = renderHook(({ docId }) => useDocumentFreshness({
      collection: 'sermons', docId, uid: 'u', enabled: true, known: { title: 'same' }, select: (data) => ({ title: data.title }),
    }), { initialProps: { docId: 'a' } });
    let resolve!: (value: { title: string }) => void;
    (readSermonFromServer as jest.Mock).mockReturnValue(new Promise((yes) => { resolve = yes; }));
    act(() => fail!({ code: 'permission-denied' }));
    act(() => { void result.current.checkAgain(); });
    const old = emit;
    rerender({ docId: 'b' });
    await act(async () => { old!(server({ title: 'wrong document' })); resolve({ title: 'wrong document' }); });
    expect(result.current.diagnostics).toEqual({ lastServerResponseAt: null, lastServerResult: null, incident: null });
    expect(result.current.remote).toBeNull();
    expect(result.current.checking).toBe(false);
  });

  it('does not check without an enabled document and owner', async () => {
    const { result } = render({ title: 'same' }, false);
    await act(async () => { await result.current.checkAgain(); });
    expect(result.current.canCheck).toBe(false);
    expect(getDocFromServer).not.toHaveBeenCalled();
  });
});


describe('sermon freshness recovery', () => {
  const open = () => renderHook(() => useDocumentFreshness({
    collection: 'sermons', docId: 'sermon', uid: 'owner', enabled: true,
    known: { title: 'Local' }, select: data => ({ title: data.title as string }),
  }));
  beforeEach(() => {
    jest.useFakeTimers();
    (readSermonFromServer as jest.Mock).mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('automatically checks a cache-only startup and reports the newer copy without applying it', async () => {
    (readSermonFromServer as jest.Mock).mockResolvedValue({ title: 'Remote' });
    const { result } = open();
    act(() => emit!(server({ title: 'Local' }, { fromCache: true })));
    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    expect(readSermonFromServer).toHaveBeenCalledWith('sermon');
    expect(result.current.state).toBe('stale');
    expect(result.current.remote).toEqual({ title: 'Remote' });
    expect(result.current.diagnostics.lastServerResult).toBe('different');
  });

  it('does not issue recovery traffic after the listener has already confirmed the document', async () => {
    open();
    act(() => emit!(server({ title: 'Local' })));
    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    expect(readSermonFromServer).not.toHaveBeenCalled();
  });

  it('keeps failed verification unknown and recovers on a manual retry', async () => {
    (readSermonFromServer as jest.Mock).mockRejectedValueOnce({ code: 'unavailable' });
    const { result } = open();
    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    expect(result.current.state).toBe('unknown');
    (readSermonFromServer as jest.Mock).mockResolvedValue({ title: 'Local' });
    await act(async () => { await result.current.checkAgain(); });
    expect(result.current.state).toBe('fresh');
    expect(result.current.diagnostics.incident).toBeNull();
  });

  it('does not call a committed HTTP version newer while this device has pending writes', async () => {
    (readSermonFromServer as jest.Mock).mockResolvedValue({ title: 'Old server value' });
    const { result } = open();
    act(() => emit!(server({ title: 'Local' }, { hasPendingWrites: true })));
    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    expect(result.current.state).toBe('unknown');
    expect(result.current.remote).toBeNull();
    expect(result.current.diagnostics.incident?.origin.reason).toBe('pendingChanges');
    act(() => emit!(server({ title: 'Local' })));
    expect(result.current.state).toBe('fresh');
  });

  it('ignores a late recovery answer superseded by a server snapshot', async () => {
    let finish!: (value: unknown) => void;
    (readSermonFromServer as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = open();
    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    act(() => emit!(server({ title: 'Local' })));
    await act(async () => { finish({ title: 'Old' }); });
    expect(result.current.state).toBe('fresh');
    expect(result.current.remote).toBeNull();
  });
});


describe('semantic snapshot comparison', () => {
  it('keeps identical nested maps fresh and still detects a real reference change', () => {
    const local = { scriptureRefs: [{ book: 'Psalms', chapter: 5, fromVerse: 5, toVerse: 5, id: 'r' }] };
    const remote = { scriptureRefs: [{ id: 'r', toVerse: 5, fromVerse: 5, chapter: 5, book: 'Psalms' }] };
    const { result, rerender } = renderHook(({ known }) => useDocumentFreshness({
      collection: 'studyNotes', docId: 'n', uid: 'u', enabled: true, known,
      select: (data) => ({ scriptureRefs: data.scriptureRefs }),
    }), { initialProps: { known: local } });
    act(() => emit!(server(remote)));
    expect(result.current.state).toBe('fresh');
    act(() => emit!(server({ scriptureRefs: [{ ...remote.scriptureRefs[0], fromVerse: 4 }] })));
    expect(result.current.state).toBe('stale');
    rerender({ known: { scriptureRefs: [{ ...local.scriptureRefs[0], fromVerse: 4 }] } });
    expect(result.current.state).toBe('fresh');
  });
});
