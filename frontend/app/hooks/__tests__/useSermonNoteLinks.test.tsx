import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { useAuth } from '@/providers/AuthProvider';
import { settleEngine } from '../../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../../test-utils/membershipEngineHarness';
import { getSermons } from '@services/sermon.service';
import { getStudyNotes } from '@services/studies.service';

import {
  applySourceNoteLinkPatch,
  openingContextOf,
  useSermonsBuiltOnNote,
  useSourceNoteLink,
  useSourceNotes,
} from '../useSermonNoteLinks';

import type { ResourceSnapshot } from '@/data-engine/types';
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
jest.mock('@services/sermon.service', () => ({ getSermons: jest.fn() }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), message: jest.fn() } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockGetStudyNotes = getStudyNotes as jest.MockedFunction<typeof getStudyNotes>;
const mockGetSermons = getSermons as jest.MockedFunction<typeof getSermons>;

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

/**
 * THE WRITE runs on the data engine: the link list is committed through a document action on the
 * stored sermon (real engine, only I/O replaced), so these tests assert on the stored document and
 * on what the hook hands back, not on a legacy writer's arguments.
 */
describe('useSourceNoteLink — the write', () => {
  const resource = { collection: 'sermons', id: 's1' };
  const stored = (links?: string[], title = 'Sermon s1'): ResourceSnapshot => ({
    resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    value: { userId: 'u1', title, verse: 'John 1:1', date: '2026-08-10T00:00:00.000Z', thoughts: [], ...(links ? { sourceNoteIds: links } : {}) },
  });

  /** Real engine under the hook; `snapshots` is what the "server" holds. */
  const engineHarness = (snapshots: ResourceSnapshot[] = [stored()]) => {
    // A link may only name a live note the person owns, so the notes the tests link to exist.
    const notes = ['n1', 'n2', 'n3', 'mine', 'extra', 'from-the-phone'].map((id): ResourceSnapshot => ({
      resource: { collection: 'studyNotes', id }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
      value: { userId: 'u1', title: id, content: '', scriptureRefs: [], tags: [], isDraft: false },
    }));
    const engine = membershipEngineHarness([...snapshots, ...notes]);
    jest.mocked(createBrowserDataEngine).mockImplementation(engine.createBrowser);
    const { client } = harness();
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>
        <DataEngineProvider>{children}</DataEngineProvider>
      </QueryClientProvider>
    );
    return { engine, client, wrapper: Wrapper };
  };
  const storedLinks = (engine: ReturnType<typeof membershipEngineHarness>) => engine.read(resource).value?.sourceNoteIds;
  const deliver = (engine: ReturnType<typeof membershipEngineHarness>) =>
    act(async () => { await engine.engine.retry(); await settleEngine(); });
  /** The hook is ready to commit once the engine provider has produced a browser engine. */
  const ready = async (result: { current: ReturnType<typeof useSourceNoteLink> }) => {
    await act(async () => { await settleEngine(); });
    return result;
  };

  beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it('stores the chosen list on the document and reports a patch, keeping undefined apart from empty', async () => {
    const target = sermon('s1'); // never linked: the stored document has no such field
    const { engine, wrapper } = engineHarness();
    const onPatched = jest.fn();

    const { result } = renderHook(() => useSourceNoteLink(target, onPatched), { wrapper });
    await ready(result);
    const saved = await act(() => result.current.setSourceNotes(['n1'], openingContextOf(target)));
    await deliver(engine);

    expect(saved.outcome).toBe('saved');
    await waitFor(() => expect(storedLinks(engine)).toEqual(['n1']));
    expect(openingContextOf(target).noteIds).toBeNull();
    expect(onPatched).toHaveBeenCalledWith({ sermonId: 's1', sourceNoteIds: ['n1'] });
  });

  it('hands back a list chosen elsewhere since the dialog opened, and never overwrites it', async () => {
    // The defect this locks out: the picker still holds the old ticks while the stored sermon
    // moved on (the phone chose n2). Saving the old selection must not replace the phone's choice.
    const opened = sermon('s1', ['n1'], 3);
    const opening = openingContextOf(opened);
    const { engine, client, wrapper } = engineHarness([stored(['n2'])]);
    client.setQueryData(['sermons', 'u1'], [opened]);

    const { result } = renderHook(() => useSourceNoteLink(opened), { wrapper });
    await ready(result);
    // The person ticked one more note in the dialog, which is why they are saving at all.
    const outcome = await act(() => result.current.setSourceNotes(['n1', 'n3'], opening));
    await deliver(engine);

    expect(outcome.outcome).toBe('stale');
    expect(outcome.serverNoteIds).toEqual(['n2']);
    expect(storedLinks(engine)).toEqual(['n2']);
    expect(engine.transport.send).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('freshness.staleSaveToast');
  });

  it('adopts the stored list into the cached list on a refusal, so the screen agrees with it', async () => {
    const target = sermon('s1', ['mine'], 3);
    const { client, wrapper } = engineHarness([stored(['from-the-phone'])]);
    client.setQueryData(['sermons', 'u1'], [target]);

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper });
    await ready(result);
    const outcome = await act(() => result.current.setSourceNotes(['mine', 'extra'], openingContextOf(target)));

    expect(outcome).toEqual({ outcome: 'stale', serverNoteIds: ['from-the-phone'] });
    expect(client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0].sourceNoteIds).toEqual(['from-the-phone']);
  });

  it('accepts a second press that matches what is stored now, instead of refusing again', async () => {
    const target = sermon('s1', ['mine'], 3);
    const { engine, wrapper } = engineHarness([stored(['from-the-phone'])]);

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper });
    await ready(result);
    const first = await act(() => result.current.setSourceNotes(['mine', 'extra'], openingContextOf(target)));
    expect(first.outcome).toBe('stale');
    // The dialog adopted the stored list and the person now picks from there.
    const adopted = openingContextOf(sermon('s1', first.serverNoteIds, 3));
    const second = await act(() => result.current.setSourceNotes(['from-the-phone', 'extra'], adopted));
    await deliver(engine);

    expect(second.outcome).toBe('saved');
    await waitFor(() => expect(storedLinks(engine)).toEqual(['from-the-phone', 'extra']));
  });

  it('keeps the choice when the device is offline: stored locally, shown, replayed later, never refused', async () => {
    const target = sermon('s1', [], 3);
    const { engine, client, wrapper } = engineHarness([stored([])]);
    client.setQueryData(['sermons', 'u1'], [target]);
    jest.mocked(engine.transport.send).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper });
    await ready(result);
    const outcome = await act(() => result.current.setSourceNotes(['n1'], openingContextOf(target)));

    // The engine accepts the write durably, so the dialog is told "saved": delivery is the
    // engine's business and there is nothing left for a Cancel button to cancel.
    expect(outcome.outcome).toBe('saved');
    expect(client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0].sourceNoteIds).toEqual(['n1']);
    expect(await engine.commits.list('u1')).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('writes nothing when the selection did not change', async () => {
    const target = sermon('s1', ['n1', 'n2'], 3);
    const { engine, wrapper } = engineHarness([stored(['n1', 'n2'])]);

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper });
    await ready(result);
    // Same set, different order — still nothing to save.
    const outcome = await act(() => result.current.setSourceNotes(['n2', 'n1'], openingContextOf(target)));
    await deliver(engine);

    expect(outcome.outcome).toBe('unchanged');
    expect(engine.transport.send).not.toHaveBeenCalled();
    expect(await engine.commits.list('u1')).toEqual([]);
  });

  it('says the save failed instead of failing silently when the sermon no longer exists', async () => {
    const target = sermon('s1');
    const { wrapper } = engineHarness([]);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper });
    await ready(result);
    const outcome = await act(() => result.current.setSourceNotes(['n1'], openingContextOf(target)));

    expect(outcome.outcome).toBe('failed');
    expect(toast.error).toHaveBeenCalledWith('sermon.sourceNotes.saveError');
    consoleError.mockRestore();
  });

  it('does nothing at all without a sermon to write to', async () => {
    const { engine, wrapper } = engineHarness();
    const { result } = renderHook(() => useSourceNoteLink(undefined), { wrapper });
    await ready(result);

    const outcome = await act(() => result.current.setSourceNotes(['n1'], { sermonId: null, noteIds: null, revision: 0 }));

    expect(outcome.outcome).toBe('failed');
    expect(await engine.commits.list('u1')).toEqual([]);
  });

  it('merges the LIST entity in place, without dragging a stale snapshot in', async () => {
    const startedFrom = sermon('s1', [], 3, 'Title as the save began');
    const { client, wrapper } = engineHarness([stored([])]);
    // Meanwhile the list learned a newer title from somewhere else.
    client.setQueryData(['sermons', 'u1'], [sermon('s1', [], 3, 'Renamed in the list')]);

    const { result } = renderHook(() => useSourceNoteLink(startedFrom), { wrapper });
    await ready(result);
    await act(() => result.current.setSourceNotes(['n1'], openingContextOf(startedFrom)));

    const cached = client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0];
    expect(cached?.sourceNoteIds).toEqual(['n1']);
    // Writing the whole entity back would have reverted this title, and `refetchType: 'none'`
    // would then have persisted the wrong copy to disk.
    expect(cached?.title).toBe('Renamed in the list');
  });

  it('cancels an in-flight list fetch before publishing, so an older response cannot win', async () => {
    const target = sermon('s1', [], 3);
    const { client, wrapper } = engineHarness([stored([])]);
    client.setQueryData(['sermons', 'u1'], [target]);
    const cancelQueries = jest.spyOn(client, 'cancelQueries');

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper });
    await ready(result);
    await act(() => result.current.setSourceNotes(['n1'], openingContextOf(target)));

    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: ['sermons', 'u1'] });
  });

  it('writes a DELIBERATE choice even when it equals the value the dialog opened with', async () => {
    // Open with A, the person unticks and re-ticks back to A. Skipping that write would leave a
    // state they did not choose; with `force` the guard runs instead of short-circuiting.
    const target = sermon('s1', ['n1'], 3);
    const { engine, wrapper } = engineHarness([stored(['n1'])]);
    const onPatched = jest.fn();

    const { result } = renderHook(() => useSourceNoteLink(target, onPatched), { wrapper });
    await ready(result);
    const outcome = await act(() => result.current.setSourceNotes(['n1'], openingContextOf(target), { force: true }));
    await deliver(engine);

    expect(outcome.outcome).toBe('saved');
    expect(onPatched).toHaveBeenCalledWith({ sermonId: 's1', sourceNoteIds: ['n1'] });
    await waitFor(() => expect(storedLinks(engine)).toEqual(['n1']));
  });

  it('refuses a write whose proof belongs to a DIFFERENT sermon', async () => {
    const opening = openingContextOf(sermon('s1', ['n1'], 3));
    const { engine, wrapper } = engineHarness();
    const { result } = renderHook(() => useSourceNoteLink(sermon('s2', ['n1'], 3)), { wrapper });
    await ready(result);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await act(() => result.current.setSourceNotes(['n1', 'n2'], opening));

    expect(outcome.outcome).toBe('failed');
    expect(await engine.commits.list('u1')).toEqual([]);
    consoleError.mockRestore();
  });

  it('AWAITS the cancellation before touching the cache', async () => {
    const target = sermon('s1', [], 3);
    const { client, wrapper } = engineHarness([stored([])]);
    client.setQueryData(['sermons', 'u1'], [target]);
    let releaseCancel: () => void = () => {};
    jest
      .spyOn(client, 'cancelQueries')
      .mockImplementation(() => new Promise<void>((resolve) => { releaseCancel = () => resolve(); }));

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper });
    await ready(result);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.setSourceNotes(['n1'], openingContextOf(target)); });
    await act(async () => { await settleEngine(); });

    // Merging before the cancellation resolves is the bug: an in-flight fetch would land after
    // it and restore the old links. Dropping the `await` must make this fail.
    expect(client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0].sourceNoteIds).toEqual([]);

    await act(async () => { releaseCancel(); await pending; });
    expect(client.getQueryData<Sermon[]>(['sermons', 'u1'])?.[0].sourceNoteIds).toEqual(['n1']);
  });

  it("never refetches the document behind the person's back", async () => {
    // The projection-based banner is what tells the person about other devices' changes, so the
    // writer must not invent a refetch of its own: exactly one list invalidation, refetch-free.
    const target = sermon('s1', [], 3);
    const { client, wrapper } = engineHarness([stored([])]);
    client.setQueryData(['sermons', 'u1'], [target]);
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSourceNoteLink(target), { wrapper });
    await ready(result);
    await act(() => result.current.setSourceNotes(['n1'], openingContextOf(target)));

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sermons', 'u1'], refetchType: 'none' });
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
