import { act, renderHook } from '@testing-library/react';

import usePlanTextDraft from '@/(pages)/(private)/sermons/[id]/plan/usePlanTextDraft';
import { draftKey, readDraft, saveDraft } from '@/utils/durableDraft';

/**
 * THE DRAFT IS THE LAST COPY, SO IT IS JUDGED BY WHETHER IT SURVIVES.
 *
 * Everything else in the plan's write path exists to refuse a save that would overwrite someone
 * else. That is only an improvement while the refused text is somewhere that outlives the tab;
 * the moment the draft can lose it, the whole mechanism has merely moved the loss from the
 * other person's paragraph to this one's.
 */

jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

const UID = 'user-1';
const SERMON = 'sermon-1';
/** One key per cell — see the hook's own note on why the shared slot had to go. */
const cellKey = (nodeId: string) => draftKey(UID, SERMON, `plan:${nodeId}`);
const storeCells = (cells: Record<string, string>) =>
  Object.entries(cells).forEach(([nodeId, text]) => saveDraft(cellKey(nodeId), text));
const storedCell = (nodeId: string) => readDraft<string>(cellKey(nodeId))?.value;

const render = (props: {
  content?: Record<string, string>;
  modified?: Record<string, boolean>;
  pending?: Set<string>;
  live?: Set<string>;
}) =>
  renderHook(
    ({ content, modified, pending, live }) =>
      usePlanTextDraft({
        uid: UID,
        sermonId: SERMON,
        contentByNodeId: content ?? {},
        modifiedNodeIds: modified ?? {},
        pendingNodeIds: pending ?? new Set(),
        liveNodeIds: live ?? new Set(['p1', 'p2']),
      }),
    {
      initialProps: {
        content: props.content ?? {},
        modified: props.modified ?? {},
        pending: props.pending ?? new Set<string>(),
        live: props.live ?? new Set(['p1', 'p2']),
      },
    }
  );

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the plan draft', () => {
  it('offers what a previous session left unconfirmed', () => {
    storeCells({ p1: 'written last night' });

    const { result } = render({});

    expect(result.current.recovered).toEqual({ p1: 'written last night' });
  });

  /**
   * THE ONE THAT MATTERS MOST.
   *
   * A screen mounts before its cells are seeded, so for one render the editor is empty and the
   * recovered draft is the only thing that looks unconfirmed. If that instant is taken as "this
   * is what the server has", the very next pass calls the draft confirmed and writes an empty
   * map over it — the offer is still on screen while the text behind it is already gone, and a
   * tab closed at that moment takes the paragraph with it.
   */
  it('does not delete itself once the screen has seeded the server text', () => {
    storeCells({ p1: 'written last night' });

    const view = render({});
    // Seeding lands: the cell now holds what the server has, and nothing is being typed.
    view.rerender({
      content: { p1: 'what the server has' },
      modified: {},
      pending: new Set<string>(),
      live: new Set(['p1', 'p2']),
    });
    act(() => { jest.advanceTimersByTime(1000); });

    expect(storedCell('p1')).toBe('written last night');
    expect(view.result.current.recovered).toEqual({ p1: 'written last night' });
  });

  /**
   * TWO TABS ON ONE SERMON SHARE THE SLOT. Whichever writes last must not erase the other's
   * unconfirmed paragraph — after a crash both are the last copy of something.
   */
  it('keeps a cell another tab left there', () => {
    storeCells({ p1: 'the other tab was typing this' });

    const view = render({});
    view.rerender({
      content: { p1: 'what the server has', p2: 'mine' },
      modified: { p2: true },
      pending: new Set<string>(),
      live: new Set(['p1', 'p2']),
    });
    act(() => { jest.advanceTimersByTime(1000); });

    expect(storedCell('p2')).toBe('mine');
    expect(storedCell('p1')).toBe('the other tab was typing this');
  });

  it('keeps a cell whose write is still queued offline', () => {
    const view = render({});
    view.rerender({
      content: { p1: 'written on the train' },
      modified: {},
      pending: new Set(['p1']),
      live: new Set(['p1', 'p2']),
    });
    act(() => { jest.advanceTimersByTime(1000); });

    expect(storedCell('p1')).toBe('written on the train');
  });

  it('retires the draft once every cell is confirmed', () => {
    const view = render({ content: { p1: 'typed' }, modified: { p1: true } });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(storedCell('p1')).toBe('typed');

    view.rerender({
      content: { p1: 'typed' },
      modified: { p1: false },
      pending: new Set<string>(),
      live: new Set(['p1', 'p2']),
    });
    act(() => { jest.advanceTimersByTime(1000); });

    expect(storedCell('p1')).toBeUndefined();
  });

  describe('a cell whose node is gone', () => {
    it('is not offered, because no card could show it', () => {
      storeCells({ p1: 'still here', gone: 'node was deleted elsewhere' });

      const { result } = render({});

      expect(result.current.recovered).toEqual({ p1: 'still here' });
    });

    /**
     * DISCARD DELETES WHAT WAS SHOWN, AND ONLY THAT. Comparing against the unfiltered record
     * would throw away a cell the person was never told about — a copy they could not see being
     * destroyed by a button that said something else.
     */
    it('survives a discard of the cells that were shown', () => {
      storeCells({ p1: 'still here', gone: 'node was deleted elsewhere' });

      const { result } = render({});
      act(() => { result.current.discard(); });

      expect(storedCell('p1')).toBeUndefined();
      expect(storedCell('gone')).toBe('node was deleted elsewhere');
    });
  });
});
