import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/providers/AuthProvider';
import { OfflineQueuedError, StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { getSermons, updateSermon } from '@services/sermon.service';
import { getStudyNotes } from '@services/studies.service';

import {
  applySourceNoteLinkPatch,
  openingContextOf,
  useSermonsBuiltOnNote,
  useSourceNoteLink,
  useSourceNotes,
} from '../useSermonNoteLinks';

import type { Sermon, StudyNote } from '@/models/models';

/**
 * BOTH DIRECTIONS COME FROM ONE STORED LIST, so these tests are about derivation, not storage.
 *
 * The heaviest ones are about the two ways this feature can lose someone's work, both found by
 * adversarial review: a save that pairs an OLD selection with a FRESH baseline (the guard then
 * blesses the overwrite), and a save that publishes the whole sermon snapshot it started from
 * (resurrecting a title or thought edited while the write was in flight).
 */
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@services/studies.service', () => ({ getStudyNotes: jest.fn() }));
jest.mock('@services/sermon.service', () => ({ getSermons: jest.fn(), updateSermon: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), message: jest.fn() } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockGetStudyNotes = getStudyNotes as jest.MockedFunction<typeof getStudyNotes>;
const mockGetSermons = getSermons as jest.MockedFunction<typeof getSermons>;
const mockUpdateSermon = updateSermon as jest.MockedFunction<typeof updateSermon>;

/** Wrapper plus the client itself: the reverse side reads this cache, so tests can inspect it. */
const harness = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper: Wrapper };
};

const wrapper = () => harness().wrapper;

const note = (id: string, title: string): StudyNote =>
  ({
    id,
    userId: 'u1',
    title,
    content: '',
    scriptureRefs: [],
    tags: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    isDraft: false,
  }) as StudyNote;

const sermon = (id: string, sourceNoteIds?: string[], revision = 3, title = `Sermon ${id}`): Sermon =>
  ({
    id,
    title,
    verse: 'John 1:1',
    date: '2026-08-10T00:00:00.000Z',
    thoughts: [],
    userId: 'u1',
    sourceNoteIds,
    rev: { core: revision },
  }) as Sermon;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: { uid: 'u1' }, loading: false } as never);
});

describe('useSourceNotes — what the sermon screen shows', () => {
  it('resolves the notes in the order the sermon stores them', async () => {
    mockGetStudyNotes.mockResolvedValue([note('n1', 'First'), note('n2', 'Second')]);

    const { result } = renderHook(() => useSourceNotes(sermon('s1', ['n2', 'n1'])), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.notes).toHaveLength(2));
    expect(result.current.notes.map((n) => n.title)).toEqual(['Second', 'First']);
    expect(result.current.missingIds).toEqual([]);
  });

  it('reports a note deleted after linking instead of rendering a dead chip', async () => {
    mockGetStudyNotes.mockResolvedValue([note('n1', 'First')]);

    const { result } = renderHook(() => useSourceNotes(sermon('s1', ['n1', 'gone'])), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(result.current.missingIds).toEqual(['gone']);
  });

  it('does not trust a cache that was never refetched in this session', async () => {
    // Cache-first keeps data "fresh" for 30 seconds and a persisted cache can be older still, so
    // an array that predates this screen is no evidence that a note was deleted — another device
    // may have created it a moment ago. Nothing is refetched here, so nothing may be judged.
    const { client, wrapper: Wrapper } = harness();
    client.setQueryData(['study-notes', 'u1'], [note('n1', 'Known note')], {
      updatedAt: Date.now() - 5_000,
    });

    const { result } = renderHook(() => useSourceNotes(sermon('s1', ['n1', 'created-elsewhere'])), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(result.current.missingIds).toEqual([]);
    expect(mockGetStudyNotes).not.toHaveBeenCalled();
  });

  it('does not read the note collection at all for a sermon with no links', async () => {
    const { result } = renderHook(() => useSourceNotes(sermon('s1')), { wrapper: wrapper() });

    expect(result.current.notes).toEqual([]);
    expect(result.current.loading).toBe(false);
    // A note document carries its whole text: fetching every one of them to render nothing is
    // a real cost on a screen that only sometimes has links.
    await waitFor(() => expect(mockGetStudyNotes).not.toHaveBeenCalled());
  });
});

describe('useSermonsBuiltOnNote — what the note screen shows', () => {
  it('finds every sermon that names this note and no others', async () => {
    mockGetSermons.mockResolvedValue([
      sermon('s1', ['n1']),
      sermon('s2', ['n2', 'n1']),
      sermon('s3', ['n2']),
      sermon('s4'),
    ]);

    const { result } = renderHook(() => useSermonsBuiltOnNote('n1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.sermons).toHaveLength(2));
    expect(result.current.sermons.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('does not query at all for a note that does not exist yet', () => {
    renderHook(() => useSermonsBuiltOnNote(undefined), { wrapper: wrapper() });

    expect(mockGetSermons).not.toHaveBeenCalled();
  });
});

describe('openingContextOf — what an editor may vouch for', () => {
  it('keeps "never linked" apart from "linked to nothing"', () => {
    expect(openingContextOf(sermon('s1'))).toEqual({ sermonId: 's1', noteIds: null, revision: 3 });
    expect(openingContextOf(sermon('s1', []))).toEqual({ sermonId: 's1', noteIds: [], revision: 3 });
  });

  it('freezes the list by COPY, so a later mutation of the source cannot rewrite the baseline', () => {
    const ids = ['n1'];
    const context = openingContextOf({
      id: 's1',
      sourceNoteIds: ids,
      rev: { core: 2 },
    } as unknown as Sermon);
    ids.push('sneaked-in');

    expect(context.noteIds).toEqual(['n1']);
  });

  it('reads a missing counter as zero rather than blocking the first save', () => {
    expect(openingContextOf({ id: 's1', sourceNoteIds: ['n1'] } as Sermon)).toEqual({
      sermonId: 's1',
      noteIds: ['n1'],
      revision: 0,
    });
  });
});

describe('useSourceNoteLink — the write', () => {
  it('states the revision and the OPENING value, keeping undefined apart from empty', async () => {
    const target = sermon('s1'); // never linked: the server holds nothing in this field
    mockUpdateSermon.mockResolvedValue({ ...target, sourceNoteIds: ['n1'] });
    const onUpdate = jest.fn();

    const { result } = renderHook(() => useSourceNoteLink(target, onUpdate), {
      wrapper: wrapper(),
    });
    const saved = await result.current.setSourceNotes(['n1'], openingContextOf(target));

    expect(saved.outcome).toBe('saved');
    expect(mockUpdateSermon).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', sourceNoteIds: ['n1'] }),
      { sourceNoteIds: ['n1'] },
      3,
      { sourceNoteIds: null }
    );
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ sourceNoteIds: ['n1'] }));
  });

  it('vouches for the list the DIALOG opened with, even after the sermon underneath refreshed', async () => {
    // The defect this locks out: the picker still holds the old ticks while this component
    // re-renders with the phone's newer sermon. Sending the NEW revision with the OLD selection
    // would make the guard bless an overwrite of the phone's choice.
    const opened = sermon('s1', ['n1'], 3);
    const opening = openingContextOf(opened);
    const refreshed = sermon('s1', ['n2'], 7);
    mockUpdateSermon.mockRejectedValue(
      new StaleWriteError('core', 3, 7, { sourceNoteIds: ['n2'] })
    );

    const { result, rerender } = renderHook(({ s }: { s: Sermon }) => useSourceNoteLink(s), {
      wrapper: wrapper(),
      initialProps: { s: opened },
    });
    rerender({ s: refreshed });
    // The person ticked one more note in the dialog, which is why they are saving at all.
    const outcome = await result.current.setSourceNotes(['n1', 'n3'], opening);

    expect(mockUpdateSermon).toHaveBeenCalledWith(
      expect.anything(),
      { sourceNoteIds: ['n1', 'n3'] },
      3, // the revision at OPEN, not the refreshed 7
      { sourceNoteIds: ['n1'] } // the list at OPEN, not the refreshed ['n2']
    );
    expect(outcome.outcome).toBe('stale');
    expect(outcome.serverNoteIds).toEqual(['n2']);
  });

  it('merges the LIST entity in place, without dragging the rest of the saved snapshot in', async () => {
    const startedFrom = sermon('s1', [], 3, 'Title as the save began');
    // Firestore accepted the write, and the service answers with the snapshot the save carried.
    mockUpdateSermon.mockResolvedValue({
      ...startedFrom,
      sourceNoteIds: ['n1'],
      updatedAt: '2026-08-16T23:00:00.000Z',
      rev: { core: 4 },
    });
    const { client, wrapper: Wrapper } = harness();
    // Meanwhile the list learned a newer title from somewhere else.
    client.setQueryData(['sermons', 'u1'], [sermon('s1', [], 3, 'Renamed in the list')]);

    const { result } = renderHook(() => useSourceNoteLink(startedFrom), { wrapper: Wrapper });
    await result.current.setSourceNotes(['n1'], openingContextOf(startedFrom));

    const cached = client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0];
    expect(cached?.sourceNoteIds).toEqual(['n1']);
    // Writing the whole entity back would have reverted this title, and `refetchType: 'none'`
    // would then have persisted the wrong copy to disk.
    expect(cached?.title).toBe('Renamed in the list');
    expect(cached?.rev?.core).toBe(4);
  });

  it('adopts the server list on a refusal, so a second press is not doomed to refuse again', async () => {
    const target = sermon('s1', ['mine'], 3);
    mockUpdateSermon.mockRejectedValue(
      new StaleWriteError('core', 3, 9, { sourceNoteIds: ['from-the-phone'] })
    );
    const { client, wrapper: Wrapper } = harness();
    client.setQueryData(['sermons', 'u1'], [target]);

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper: Wrapper });
    const outcome = await result.current.setSourceNotes(['mine', 'extra'], openingContextOf(target));

    expect(outcome).toEqual({
      outcome: 'stale',
      serverNoteIds: ['from-the-phone'],
      serverRevision: 9,
    });
    const cached = client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0];
    expect(cached?.sourceNoteIds).toEqual(['from-the-phone']);
    expect(cached?.rev?.core).toBe(9);
    expect(toast.error).toHaveBeenCalledWith('freshness.staleSaveToast');
  });

  it('treats an offline write as QUEUED — the choice is durable, so it is shown, not refused', async () => {
    const target = sermon('s1', [], 3);
    mockUpdateSermon.mockRejectedValue(new OfflineQueuedError('core'));
    const { client, wrapper: Wrapper } = harness();
    client.setQueryData(['sermons', 'u1'], [target]);

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper: Wrapper });
    const outcome = await result.current.setSourceNotes(['n1'], openingContextOf(target));

    expect(outcome.outcome).toBe('queued');
    // The intent is already in the outbox and will replay through the same guard, so the screen
    // must agree with it; anything else invites a second press that queues a duplicate.
    expect(client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0].sourceNoteIds).toEqual(['n1']);
    expect(toast.message).toHaveBeenCalledWith('freshness.queuedPending');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('writes nothing when the selection did not change', async () => {
    const target = sermon('s1', ['n1', 'n2'], 3);

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper: wrapper() });
    // Same set, different order — still nothing to save.
    const outcome = await result.current.setSourceNotes(['n2', 'n1'], openingContextOf(target));

    expect(outcome.outcome).toBe('unchanged');
    expect(mockUpdateSermon).not.toHaveBeenCalled();
  });

  it('says the save failed on an unknown error instead of failing silently', async () => {
    const target = sermon('s1');
    mockUpdateSermon.mockRejectedValue(new Error('network exploded'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper: wrapper() });
    const outcome = await result.current.setSourceNotes(['n1'], openingContextOf(target));

    expect(outcome.outcome).toBe('failed');
    expect(toast.error).toHaveBeenCalledWith('sermon.sourceNotes.saveError');
    consoleError.mockRestore();
  });

  it('does nothing at all without a sermon to write to', async () => {
    const { result } = renderHook(() => useSourceNoteLink(undefined), { wrapper: wrapper() });

    const outcome = await result.current.setSourceNotes(['n1'], {
      sermonId: null,
      noteIds: null,
      revision: 0,
    });

    expect(outcome.outcome).toBe('failed');
    expect(mockUpdateSermon).not.toHaveBeenCalled();
  });

  it('cancels an in-flight list fetch before publishing, so an older response cannot win', async () => {
    const target = sermon('s1', [], 3);
    mockUpdateSermon.mockResolvedValue({ ...target, sourceNoteIds: ['n1'], rev: { core: 4 } });
    const { client, wrapper: Wrapper } = harness();
    client.setQueryData(['sermons', 'u1'], [target]);
    const cancelQueries = jest.spyOn(client, 'cancelQueries');

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper: Wrapper });
    await result.current.setSourceNotes(['n1'], openingContextOf(target));

    // Without this, a `getSermons` that started before the write lands after the merge and
    // quietly restores the old links — and `refetchType: 'none'` asks for no correction.
    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: ['sermons', 'u1'] });
  });

  it('writes a DELIBERATE choice even when it equals the value the dialog opened with', async () => {
    // Open with A, the server moves to B, the person unticks and re-ticks back to A. Skipping
    // that write would leave B in place while they believe they stored A.
    const target = sermon('s1', ['n1'], 3);
    mockUpdateSermon.mockResolvedValue({ ...target, rev: { core: 4 } });

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper: wrapper() });
    const outcome = await result.current.setSourceNotes(['n1'], openingContextOf(target), {
      force: true,
    });

    expect(outcome.outcome).toBe('saved');
    expect(mockUpdateSermon).toHaveBeenCalledTimes(1);
  });

  it('refuses a write whose proof belongs to a DIFFERENT sermon', async () => {
    const opening = openingContextOf(sermon('s1', ['n1'], 3));
    const { result } = renderHook(() => useSourceNoteLink(sermon('s2', ['n1'], 3)), {
      wrapper: wrapper(),
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await result.current.setSourceNotes(['n1', 'n2'], opening);

    expect(outcome.outcome).toBe('failed');
    expect(mockUpdateSermon).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('AWAITS the cancellation before touching the cache', async () => {
    const target = sermon('s1', [], 3);
    mockUpdateSermon.mockResolvedValue({ ...target, sourceNoteIds: ['n1'], rev: { core: 4 } });
    const { client, wrapper: Wrapper } = harness();
    client.setQueryData(['sermons', 'u1'], [target]);
    let releaseCancel: () => void = () => {};
    jest
      .spyOn(client, 'cancelQueries')
      .mockImplementation(() => new Promise<void>((resolve) => { releaseCancel = () => resolve(); }));

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper: Wrapper });
    const pending = result.current.setSourceNotes(['n1'], openingContextOf(target));
    await Promise.resolve();
    await Promise.resolve();

    // Merging before the cancellation resolves is the bug: an in-flight fetch would land after
    // it and restore the old links. Dropping the `await` must make this fail.
    expect(client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0].sourceNoteIds).toEqual([]);

    releaseCancel();
    await pending;
    expect(client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0].sourceNoteIds).toEqual(['n1']);
  });

  it('never refetches the document behind the person\'s back', async () => {
    // When another device also changed the core aggregate, this app does NOT silently swap what is
    // on screen — that rule is written down in the freshness layer ("never applied for you"). The
    // projection-based banner is what tells the person, so the writer must not invent a refetch of
    // its own.
    const target = sermon('s1', [], 3);
    mockUpdateSermon.mockResolvedValue({ ...target, sourceNoteIds: ['n1'], rev: { core: 6 } });
    const { client, wrapper: Wrapper } = harness();
    client.setQueryData(['sermons', 'u1'], [target]);
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper: Wrapper });
    await result.current.setSourceNotes(['n1'], openingContextOf(target));

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sermons', 'u1'], refetchType: 'none' });
  });

  it('asks for nothing extra when the only writer was us', async () => {
    const target = sermon('s1', [], 3);
    mockUpdateSermon.mockResolvedValue({ ...target, sourceNoteIds: ['n1'], rev: { core: 4 } });
    const { client, wrapper: Wrapper } = harness();
    client.setQueryData(['sermons', 'u1'], [target]);
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper: Wrapper });
    await result.current.setSourceNotes(['n1'], openingContextOf(target));

    // Only the list invalidation that pairs with the optimistic merge — no extra read.
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sermons', 'u1'], refetchType: 'none' });
  });

  it('emits a PATCH, not an entity — the merge belongs to whoever owns a copy', async () => {
    const target = sermon('s1', [], 3);
    mockUpdateSermon.mockResolvedValue({
      ...target,
      sourceNoteIds: ['n1'],
      updatedAt: '2026-08-17T00:00:00.000Z',
      rev: { core: 4 },
    });
    const onPatched = jest.fn();

    const { result } = renderHook(() => useSourceNoteLink(target, onPatched), { wrapper: wrapper() });
    await result.current.setSourceNotes(['n1'], openingContextOf(target));

    expect(onPatched).toHaveBeenCalledWith({
      sermonId: 's1',
      sourceNoteIds: ['n1'],
      updatedAt: '2026-08-17T00:00:00.000Z',
      revision: 4,
    });
  });
});

describe('applySourceNoteLinkPatch — the merge every owner does for itself', () => {
  const patch = {
    sermonId: 's1',
    sourceNoteIds: ['n1'],
    updatedAt: '2026-08-17T00:00:00.000Z',
    revision: 4,
  };

  it('keeps everything it does not touch, including fields the list copy never carries', () => {
    // The P1 that killed the previous design: choosing between a "newer" list copy and a fuller
    // detail copy by one counter dropped `scratch`/`thoughts` from the screen. Nothing chooses any
    // more — each side merges into what it already holds.
    const detail = {
      ...sermon('s1', [], 3, 'Detail title'),
      scratch: [{ id: 'sc1', text: 'a note only the detail copy has', createdAt: '2026-08-16' }],
    } as Sermon;

    const merged = applySourceNoteLinkPatch(detail, patch);

    expect(merged.sourceNoteIds).toEqual(['n1']);
    expect(merged.scratch).toHaveLength(1);
    expect(merged.title).toBe('Detail title');
    expect(merged.rev?.core).toBe(4);
  });

  it('ignores a patch addressed to another sermon', () => {
    const other = sermon('s2', ['keep'], 3);

    expect(applySourceNoteLinkPatch(other, patch)).toBe(other);
  });

  it('changes nothing when the copy is already at or beyond the receipt', () => {
    // The shared rule (`serverCopyIsNewer`) decides, exactly as every read in this app does. A
    // receipt that cannot prove it is newer leaves the copy alone; what the server really holds
    // arrives through the ordinary read path and the freshness banner, not by force from here.
    const beyond = sermon('s1', ['written-later'], 9);
    const equal = sermon('s1', ['written-later'], 4);

    expect(applySourceNoteLinkPatch(beyond, patch)).toBe(beyond);
    expect(applySourceNoteLinkPatch(equal, patch)).toBe(equal);
  });

  it('shows an OFFLINE intent without claiming any new version for it', () => {
    // A queued write has no committed revision yet. The links are shown so the screen agrees with
    // what will be replayed, and the copy keeps its own markers so a later server answer can still
    // win.
    const copy = sermon('s1', [], 3);

    const merged = applySourceNoteLinkPatch(copy, {
      sermonId: 's1',
      sourceNoteIds: ['queued'],
    });

    expect(merged.sourceNoteIds).toEqual(['queued']);
    expect(merged.rev?.core).toBe(3);
    expect(merged.updatedAt).toBe(copy.updatedAt);
  });
});
