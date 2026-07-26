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
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
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

function render(known: { title: string } | null, enabled = true) {
  return renderHook(
    (props: { known: { title: string } | null }) =>
      useDocumentFreshness<{ title: string }>({
        collection: 'studyNotes',
        docId: 'note-1',
        uid: 'uid-1',
        enabled,
        known: props.known,
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

  it('starts as unknown — claiming "fresh" before the server answers would be a lie', () => {
    const { result } = render({ title: 'local' });
    expect(result.current.state).toBe('unknown');
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

    expect(result.current.state).toBe('unknown');
    expect(result.current.remote).toBeNull();
  });

  it('treats a cache-only snapshot as unknown, not as proof of freshness', () => {
    const { result } = render({ title: 'what we know' });

    act(() => emit!(server({ title: 'anything' }, { fromCache: true })));

    expect(result.current.state).toBe('unknown');
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
});
