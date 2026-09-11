import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useServiceOrders } from '@/hooks/useServiceOrders';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import {
  getAllServiceOrders,
  setServiceOrderRank,
  setServiceOrderRanks,
  updateServiceOrderMeta,
  updateServiceOrderSteps,
} from '@/services/serviceOrders.service';
import { serviceOrderListKey } from '@/utils/queryKeys';

/**
 * THE LIST MOVES BEFORE THE SERVER ANSWERS, AND GOES BACK IF THE SERVER SAYS NO.
 *
 * The first half is what makes a drop feel like a drop: without it the card fell back into
 * its old place and jumped to the new one when the write returned. The second half is what
 * keeps that honest — an optimistic move that survives a refused write is a screen quietly
 * disagreeing with the database, and the next reload would "lose" a change the person saw
 * happen.
 */

jest.mock('@/services/serviceOrders.service', () => ({
  getAllServiceOrders: jest.fn(),
  createServiceOrder: jest.fn(),
  deleteServiceOrder: jest.fn(),
  setServiceOrderRank: jest.fn(),
  setServiceOrderRanks: jest.fn(),
  updateServiceOrderMeta: jest.fn(),
  updateServiceOrderSteps: jest.fn(),
}));

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: 'user-1', isAuthLoading: false }),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockGetAll = getAllServiceOrders as jest.MockedFunction<typeof getAllServiceOrders>;
const mockSetRank = setServiceOrderRank as jest.MockedFunction<typeof setServiceOrderRank>;
const mockSetRanks = setServiceOrderRanks as jest.MockedFunction<typeof setServiceOrderRanks>;
const mockUpdateMeta = updateServiceOrderMeta as jest.MockedFunction<typeof updateServiceOrderMeta>;
const mockUpdateSteps = updateServiceOrderSteps as jest.MockedFunction<typeof updateServiceOrderSteps>;

/**
 * A STORE THAT ACTUALLY STORES. A mock that always answers with the original list makes any
 * refetch look like a lost change, and the hook reads as broken while being right. This one
 * keeps what the writes put in it, which is the only way a rollback test can mean anything.
 */
let stored: ReturnType<typeof order>[] = [];

const order = (id: string, rank: number) => ({
  id,
  userId: 'user-1',
  title: id,
  steps: [],
  rank,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
});

/**
 * ONE CLIENT FOR THE WHOLE RENDER, built per test rather than per render. An earlier version
 * of this file created it inside the wrapper component: every re-render handed the tree a
 * brand-new cache, so an optimistic write landed in a client that was thrown away a moment
 * later — and the hook looked broken while being right.
 */
const makeWrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { Wrapper, client };
};

describe('useServiceOrders — moving one service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stored = [order('funeral', 1000), order('wedding', 2000), order('baptism', 3000)];
    mockGetAll.mockImplementation(async () => stored.map((entry) => ({ ...entry })));
    mockSetRank.mockImplementation(async (id: string, rank: number) => {
      stored = stored.map((entry) => (entry.id === id ? { ...entry, rank } : entry));
    });
    mockSetRanks.mockImplementation(async (entries: { id: string; rank: number }[]) => {
      const byId = new Map(entries.map((entry) => [entry.id, entry.rank]));
      stored = stored.map((entry) => ({ ...entry, rank: byId.get(entry.id) ?? entry.rank }));
    });
  });

  it('writes exactly one document for a move', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(3));

    await act(async () => {
      await result.current.moveOrder('baptism', 0);
    });

    expect(mockSetRank).toHaveBeenCalledTimes(1);
    expect(mockSetRank).toHaveBeenCalledWith('baptism', expect.any(Number));
    // The cache is written synchronously; the subscriber renders a tick later.
    await waitFor(() =>
      expect(result.current.orders.map((o) => o.id)).toEqual(['baptism', 'funeral', 'wedding'])
    );
  });

  /** The card lands where it was dropped straight away — the write is still in flight. */
  it('rearranges before the write resolves', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(3));

    let release: (() => void) | undefined;
    mockSetRank.mockImplementation(
      () => new Promise<void>((resolve) => { release = () => resolve(); })
    );

    let move: Promise<unknown> | undefined;
    await act(async () => {
      move = result.current.moveOrder('baptism', 0);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.orders.map((o) => o.id)).toEqual(['baptism', 'funeral', 'wedding'])
    );

    await act(async () => {
      release?.();
      await move;
    });
  });

  /**
   * TWO CLICKS IN ONE TICK ARE ONE MOVE.
   *
   * The arrows go quiet while a move is in flight, but that only happens once React has rendered
   * the pending write. Two presses inside one tick both got through, each computing its new rank
   * from the SAME old list — so the second was written over the first and two presses became one
   * arrangement that nobody asked for.
   */
  it('ignores a second move issued before the first has answered', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(3));

    let release: (() => void) | undefined;
    mockSetRank.mockImplementation(
      () => new Promise<void>((resolve) => { release = () => resolve(); })
    );

    let first: Promise<unknown> | undefined;
    await act(async () => {
      first = result.current.moveOrder('baptism', 0);
      void result.current.moveOrder('baptism', 1);
      await Promise.resolve();
    });

    expect(mockSetRank).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await first;
    });
  });

  /**
   * A LIST WITH NO ROOM LEFT IS SPREAD OUT IN ONE PIECE.
   *
   * Written one document at a time, a refusal half-way leaves the pastor's arrangement partly
   * rewritten on the server and nothing in the browser can put it back. One batch either lands
   * whole or not at all — which is why the write interface grew a third door for it.
   */
  it('spreads a collapsed list with a single batch, not a write per row', async () => {
    stored = [order('funeral', 1000), order('wedding', 1000 + 1e-9), order('baptism', 3000)];
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(3));

    await act(async () => {
      await result.current.moveOrder('baptism', 0);
    });

    expect(mockSetRanks).toHaveBeenCalledTimes(1);
    expect(mockSetRank).not.toHaveBeenCalled();
    const spread = mockSetRanks.mock.calls[0][0];
    expect(spread).toHaveLength(3);
    await waitFor(() =>
      expect(result.current.orders.map((o) => o.id)).toEqual(['baptism', 'funeral', 'wedding'])
    );
  });

  /**
   * The assertion that keeps the optimism honest: a refused write puts the list back exactly
   * as it was, and the caller is told, so the page can say so instead of showing an order
   * that only exists on this screen.
   */
  it('puts the list back when the write is refused', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(3));

    // Refused, and the store is left untouched — exactly what a permission-denied write does.
    mockSetRank.mockRejectedValue(new Error('Missing or insufficient permissions.'));

    await act(async () => {
      await expect(result.current.moveOrder('baptism', 0)).rejects.toThrow();
    });

    await waitFor(() =>
      expect(result.current.orders.map((o) => o.id)).toEqual(['funeral', 'wedding', 'baptism'])
    );
  });
});

/**
 * TWO SAVES OF THE SAME NAME IN A ROW ARE AN ORDINARY THING TO DO, AND MUST NOT LOOK LIKE TWO
 * DEVICES FIGHTING.
 *
 * The guard refuses a write whose baseline no longer matches the server. While the editor held
 * that baseline, the second save captured the same number as the first — it was typed while the
 * first was still in the queue — and the pastor was told someone else had changed his title when
 * the only hand on it was his. The baseline now lives beside the queue and moves to whatever the
 * server committed, so the second save is judged against the first instead of against the past.
 */
describe('useServiceOrders — renaming a service twice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stored = [order('funeral', 1000)];
    mockGetAll.mockImplementation(async () => stored.map((entry) => ({ ...entry })));
    // A guarded writer that behaves like the real one: it commits at the next revision and
    // reports it, which is the only thing that lets the next write be judged truthfully.
    mockUpdateMeta.mockImplementation(async (_id, _updates, expectedRevision) =>
      (expectedRevision ?? 0) + 1
    );
  });

  it('carries the revision the previous save committed, not the one it opened on', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    act(() => result.current.openedWith('funeral', { title: 'funeral', revision: 3 }, 'session-1'));

    // Both fired before either answers — the shape of a person typing, pausing, typing again.
    await act(async () => {
      await Promise.all([
        result.current.renameOrder('funeral', 'Отпевание', 'session-1'),
        result.current.renameOrder('funeral', 'Отпевание ребёнка', 'session-1'),
      ]);
    });

    expect(mockUpdateMeta).toHaveBeenCalledTimes(2);
    expect(mockUpdateMeta.mock.calls[0][2]).toBe(3);
    expect(mockUpdateMeta.mock.calls[0][3]).toEqual({ title: 'funeral' });
    expect(mockUpdateMeta.mock.calls[1][2]).toBe(4);
    expect(mockUpdateMeta.mock.calls[1][3]).toEqual({ title: 'Отпевание' });
  });

  /**
   * A SITTING RELEASES ITS OWN BASELINE AND NOBODY ELSE'S.
   *
   * The release runs behind whatever was still being written, which can be after the pastor has
   * pressed "Изменить" again. Releasing whatever it found took the baseline out from under that
   * new sitting, and its first rename went to the server unguarded — free to overwrite a title
   * another device had changed in the meantime.
   */
  it('does not let a closed sitting release the baseline of the one that followed it', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    act(() => result.current.openedWith('funeral', { title: 'funeral', revision: 3 }, 'first'));
    // The pastor is already back inside, and this sitting opened on what the rite is called now.
    act(() => result.current.openedWith('funeral', { title: 'Отпевание', revision: 9 }, 'second'));
    // Only now does the first sitting's release get its turn in the queue.
    await act(async () => {
      await result.current.closedEditing('funeral', 'first');
    });

    await act(async () => {
      await result.current.renameOrder('funeral', 'Отпевание ребёнка', 'second');
    });

    expect(mockUpdateMeta.mock.calls[0][2]).toBe(9);
    expect(mockUpdateMeta.mock.calls[0][3]).toEqual({ title: 'Отпевание' });
  });

  /**
   * A RENAME IS JUDGED AGAINST WHAT ITS OWN SITTING OPENED ON.
   *
   * A rename can sit in the queue behind another write while the pastor leaves and comes back.
   * With one baseline per rite, it woke up holding the NEW sitting's number — one the server had
   * just confirmed — so a title another device changed in between was overwritten with nothing
   * refused. One record per sitting means the waiting rename still carries its own.
   */
  it('does not let a waiting rename borrow the next sitting\'s baseline', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    act(() => result.current.openedWith('funeral', { title: 'funeral', revision: 3 }, 'first'));

    // The rename is queued behind a write that has not answered yet.
    let releaseTheWriteAhead: (() => void) | undefined;
    mockUpdateSteps.mockImplementation(
      () => new Promise((resolve) => { releaseTheWriteAhead = () => resolve([]); })
    );
    let ahead: Promise<unknown> | undefined;
    let waiting: Promise<unknown> | undefined;
    await act(async () => {
      ahead = result.current.updateSteps('funeral', (steps) => steps);
      waiting = result.current.renameOrder('funeral', 'Отпевание', 'first');
      await Promise.resolve();
    });

    // While it waits, another device renames the rite and the pastor opens a new sitting on it.
    act(() => result.current.openedWith('funeral', { title: 'С ноутбука', revision: 9 }, 'second'));

    await act(async () => {
      releaseTheWriteAhead?.();
      await ahead;
      await waiting;
    });

    expect(mockUpdateMeta.mock.calls[0][2]).toBe(3);
    expect(mockUpdateMeta.mock.calls[0][3]).toEqual({ title: 'funeral' });
  });

  /**
   * A REFUSAL THAT CANNOT NAME THE SERVER'S TITLE STILL LEAVES A GUARD.
   *
   * A document whose title is missing or is not a string at all gets refused, and the refusal has
   * no title to report. Dropping the baseline then made the SECOND press unguarded — free to
   * overwrite a rename made on another device. The revision it does report is true, so the
   * baseline keeps its title and moves to that number.
   */
  it('never leaves the next rename unguarded when the refusal reports no title', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    act(() => result.current.openedWith('funeral', { title: 'funeral', revision: 3 }, 'first'));
    mockUpdateMeta.mockRejectedValueOnce(new StaleWriteError('meta', 3, 7, {}));

    await act(async () => {
      await expect(result.current.renameOrder('funeral', 'Отпевание', 'first')).rejects.toThrow();
    });
    await act(async () => {
      await result.current.renameOrder('funeral', 'Отпевание', 'first');
    });

    expect(mockUpdateMeta.mock.calls[1][2]).toBe(7);
    expect(mockUpdateMeta.mock.calls[1][3]).toEqual({ title: 'funeral' });
  });

  /**
   * Clearing the baseline after a success left the next rename with none at all, and a write
   * with no baseline is a write the guard cannot refuse. Every save carries one.
   */
  it('never sends a rename without a baseline once the editor has opened one', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    act(() => result.current.openedWith('funeral', { title: 'funeral', revision: 3 }, 'session-1'));
    await act(async () => {
      await result.current.renameOrder('funeral', 'Отпевание', 'session-1');
    });
    await act(async () => {
      await result.current.renameOrder('funeral', 'Отпевание ребёнка', 'session-1');
    });

    for (const call of mockUpdateMeta.mock.calls) {
      expect(call[2]).toEqual(expect.any(Number));
      expect(call[3]).not.toBeNull();
    }
  });
});


/**
 * THE OTHER HALF OF THE WRITE FENCE.
 *
 * Cancelling covers the reads already in the air when a write starts. This covers a read that
 * BEGINS during one — a tab regaining focus in the middle of a transaction — which can see the
 * document before the commit and land after it. That is not merely a stale screen: with nothing
 * unsaved, the editor's fields follow the document, so the pastor types on top of the old words
 * and saves them for real.
 */
describe('useServiceOrders — a read that overlaps a write', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stored = [order('funeral', 1000)];
    mockGetAll.mockImplementation(async () => stored.map((entry) => ({ ...entry })));
  });

  it('does not let its answer replace what the write committed', async () => {
    const { Wrapper, client } = makeWrapper();
    const { result } = renderHook(() => useServiceOrders(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    const committedSteps = [{ id: 's1', title: 'Перед началом', body: 'мои слова', scriptureRefs: [] }];
    let commit: (() => void) | undefined;
    mockUpdateSteps.mockImplementation(
      () => new Promise((resolve) => { commit = () => resolve(committedSteps); })
    );

    let write: Promise<unknown> | undefined;
    await act(async () => {
      write = result.current.updateSteps('funeral', (steps) => steps);
      await Promise.resolve();
    });

    /*
     * A read begins now — after the write started, so cancelling cannot have caught it — and it
     * sees the document as it was BEFORE the transaction commits.
     *
     * The moment the read ENTERS is waited for, not assumed. Scheduling a refetch and trusting a
     * couple of microtasks passed under an empty machine and failed inside the full suite, where
     * the write finished first: the test then proved nothing and said so only occasionally,
     * which is the worst way for a test to be wrong.
     */
    let answerTheRead: (() => void) | undefined;
    let readHasBegun: (() => void) | undefined;
    const reading = new Promise<void>((resolve) => { readHasBegun = resolve; });
    mockGetAll.mockImplementationOnce(
      () => new Promise((resolve) => {
        answerTheRead = () => resolve([{ ...order('funeral', 1000), steps: [] }]);
        readHasBegun?.();
      })
    );
    const refetching = client.refetchQueries({ queryKey: serviceOrderListKey('user-1') });
    await act(async () => {
      await reading;
    });

    // The transaction commits and the cache takes what it stored.
    await act(async () => {
      commit?.();
      await write;
    });
    // The cache carries what the transaction stored, because the write publishes it itself.
    expect(
      (client.getQueryData(serviceOrderListKey('user-1')) as { steps: unknown[] }[])[0].steps
    ).toEqual(committedSteps);

    // Only now does the stale read answer. Awaiting the refetch itself, not a couple of
    // microtasks: the assertion below is a negative one, and a negative assertion made before
    // the answer has landed passes for the wrong reason — which is how this test spent a round
    // proving nothing at all.
    await act(async () => {
      answerTheRead?.();
      await refetching;
    });

    /*
     * ASKED OF THE CACHE, which is what the fence protects — not of the last render, which lags
     * it by a notification. Asserted on the render, this test passed with the fence switched
     * off: the clobbered list simply had not reached the screen yet at the moment of asking.
     */
    const cached = client.getQueryData(serviceOrderListKey('user-1')) as { steps: unknown[] }[];
    expect(cached[0].steps).toEqual(committedSteps);
  });

  /**
   * A DISCARDED READ WAS STILL A LEGITIMATE QUESTION. Keeping the cache would otherwise leave
   * the query looking freshly answered, and the answer thrown away here would be the last one
   * for as long as the tab stayed open.
   *
   * This asserts the OUTCOME — the list ends up marked stale — not the mechanism. The mark is
   * scheduled as a task rather than a microtask so that it lands after the result it qualifies,
   * but with the kept array handed back by identity there is no state change to clear it, and
   * this test cannot tell the two orderings apart. It is not claimed to.
   */
  it('asks again later instead of treating the kept cache as fresh', async () => {
    const { Wrapper, client } = makeWrapper();
    const { result } = renderHook(() => useServiceOrders(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    let answerTheRead: (() => void) | undefined;
    let readHasBegun: (() => void) | undefined;
    const reading = new Promise<void>((resolve) => { readHasBegun = resolve; });
    mockGetAll.mockImplementationOnce(
      () => new Promise((resolve) => {
        answerTheRead = () => resolve([{ ...order('funeral', 1000) }]);
        readHasBegun?.();
      })
    );
    const refetching = client.refetchQueries({ queryKey: serviceOrderListKey('user-1') });
    await act(async () => {
      await reading;
    });

    // A whole write begins and ends while that read is still in the air.
    mockUpdateSteps.mockResolvedValueOnce([]);
    await act(async () => {
      await result.current.updateSteps('funeral', (steps) => steps);
    });

    await act(async () => {
      answerTheRead?.();
      await refetching;
    });

    await waitFor(() =>
      expect(client.getQueryState(serviceOrderListKey('user-1'))?.isInvalidated).toBe(true)
    );
  });
});

/**
 * A REFUSED RENAME TELLS THE SCREEN WHAT THE SERVER ACTUALLY HAS.
 *
 * The refusal is the only thing that has seen the server. Kept as a private baseline, it left
 * the cache holding a name that exists nowhere — and the heading went back to it the moment
 * editing stopped, showing neither the pastor's attempt nor the rite's real name.
 */
describe('useServiceOrders — a rename refused as stale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stored = [order('funeral', 1000)];
    mockGetAll.mockImplementation(async () => stored.map((entry) => ({ ...entry })));
  });

  it('publishes the title the refusal reports', async () => {
    const { result } = renderHook(() => useServiceOrders(), { wrapper: makeWrapper().Wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    act(() => result.current.openedWith('funeral', { title: 'funeral', revision: 3 }, 'session-1'));
    mockUpdateMeta.mockRejectedValueOnce(
      new StaleWriteError('meta', 3, 7, { title: 'Отпевание, дополненное' })
    );

    await act(async () => {
      await expect(result.current.renameOrder('funeral', 'Погребение', 'session-1')).rejects.toThrow();
    });

    await waitFor(() => expect(result.current.orders[0].title).toBe('Отпевание, дополненное'));
    expect(result.current.orders[0].rev?.meta).toBe(7);
  });
});
