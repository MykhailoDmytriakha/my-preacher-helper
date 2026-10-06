import { act, renderHook } from '@testing-library/react';

import usePlanTextDraft from '@/(pages)/(private)/sermons/[id]/plan/usePlanTextDraft';
import { draftKey, isDraftStorageRefused, readDraft, saveDraft } from '@/utils/durableDraft';

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

type HookProps = {
  content: Record<string, string>;
  modified: Record<string, boolean>;
  pending: Set<string>;
  pendingText?: Record<string, string>;
  live: Set<string>;
};

const render = (props: {
  content?: Record<string, string>;
  modified?: Record<string, boolean>;
  pending?: Set<string>;
  pendingText?: Record<string, string>;
  live?: Set<string>;
}) =>
  renderHook(
    ({ content, modified, pending, pendingText, live }: HookProps) =>
      usePlanTextDraft({
        uid: UID,
        sermonId: SERMON,
        contentByNodeId: content ?? {},
        modifiedNodeIds: modified ?? {},
        pendingNodeIds: pending ?? new Set(),
        pendingText: pendingText ?? {},
        liveNodeIds: live ?? new Set(['p1', 'p2']),
      }),
    {
      initialProps: {
        content: props.content ?? {},
        modified: props.modified ?? {},
        pending: props.pending ?? new Set<string>(),
        pendingText: props.pendingText ?? {},
        live: props.live ?? new Set(['p1', 'p2']),
      } as HookProps,
    }
  );

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  // Refusals live in the draft module, not in localStorage: a test that failed before its cleanup
  // must fail the next one loudly rather than let its "still warns" check pass on the leftover.
  expect(isDraftStorageRefused()).toBe(false);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the plan draft', () => {
  it('tries again to keep a cell the browser refused, instead of believing the copy landed', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const view = render({ content: { p1: 'typed' }, modified: { p1: true } });
    act(() => { jest.advanceTimersByTime(1_000); });
    expect(storedCell('p1')).toBeUndefined();
    setItem.mockRestore();
    // Same text, room again: the copy is written now — it was never ours before.
    view.rerender({ content: { p1: 'typed' }, modified: { p1: true }, pending: new Set(), live: new Set(['p1', 'p2']) });
    act(() => { jest.advanceTimersByTime(1_000); });
    expect(storedCell('p1')).toBe('typed');
    view.unmount();
    jest.mocked(console.error).mockRestore();
  });

  it('stops warning about a refused copy once that cell is saved', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const view = render({ content: { p1: 'typed' }, modified: { p1: true } });
    act(() => { jest.advanceTimersByTime(1_000); });
    expect(isDraftStorageRefused()).toBe(true);
    // The server took the text; storage is still refusing, and no copy ever landed.
    view.rerender({ content: { p1: 'typed' }, modified: {}, pending: new Set(), live: new Set(['p1', 'p2']) });
    act(() => { jest.advanceTimersByTime(1_000); });
    setItem.mockRestore();
    expect(isDraftStorageRefused()).toBe(false);
    view.unmount();
    jest.mocked(console.error).mockRestore();
  });

  it('shows the last copy of a card whose point is gone, keeps it after the offer is settled, and forgets only what was seen', () => {
    storeCells({ p1: 'live card', gone: 'text of a removed point' });
    const view = render({ live: new Set(['p1']) });
    expect(view.result.current.recovered).toEqual({ p1: 'live card' });
    expect(view.result.current.orphaned).toEqual([{ id: 'gone', text: 'text of a removed point' }]);

    act(() => { view.result.current.accept(); });
    expect(view.result.current.recovered).toBeNull();
    expect(view.result.current.orphaned).toEqual([{ id: 'gone', text: 'text of a removed point' }]);

    // Another tab has written newer text under the key meanwhile: letting go of what was seen leaves it.
    saveDraft(cellKey('gone'), 'newer text from another tab');
    act(() => { view.result.current.forget({ gone: 'text of a removed point' }); });
    expect(storedCell('gone')).toBe('newer text from another tab');
    expect(view.result.current.orphaned).toEqual([]);

    saveDraft(cellKey('gone'), 'text of a removed point');
    act(() => { view.result.current.forget({ gone: 'text of a removed point' }); });
    expect(storedCell('gone')).toBeUndefined();
  });

  // BUG-20260928-orphan-forget-drops-unseen-older-draft: the orphan zone shows this session's text
  // for a gone point; an older draft found at open sits under the same key whenever the newer text
  // could not be stored. Letting go of what was shown must not delete a version shown in its place.
  it('keeps an older draft of a gone point that was not the one shown when the shown text is let go', () => {
    storeCells({ gone: 'older draft found at open' });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const view = render({ content: { gone: 'newer text typed here' }, modified: { gone: true }, live: new Set(['p1']) });
    act(() => { jest.advanceTimersByTime(1_000); });
    setItem.mockRestore();

    act(() => { view.result.current.forget({ gone: 'newer text typed here' }); });
    expect(storedCell('gone')).toBe('older draft found at open');

    // As the page does after "Убрать": the cell leaves the screen, then the person leaves.
    view.rerender({ content: {}, modified: {}, pending: new Set(), live: new Set(['p1']) });
    act(() => { jest.advanceTimersByTime(1_000); });
    view.unmount();
    expect(storedCell('gone')).toBe('older draft found at open');
    jest.mocked(console.error).mockRestore();
    window.localStorage.clear();
  });

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

/** BUG-20261003-preaching-on-copy-stores-copy-words-as-draft — the queue and a draft found at open. */
describe('a queued cell and a draft this screen did not write', () => {
  it('stores the queued words even before the screen holds the cell', () => {
    render({ pending: new Set(['p1']), pendingText: { p1: 'Queued words' } });
    act(() => { jest.advanceTimersByTime(300); });
    expect(storedCell('p1')).toBe('Queued words');
  });

  it('leaves a draft it did not write alone until the person types into the cell', () => {
    storeCells({ p1: 'Newer than the queue' });
    render({ content: { p1: 'Older words' }, pending: new Set(['p1']), pendingText: { p1: 'Queued words' } });
    act(() => { jest.advanceTimersByTime(300); });
    expect(storedCell('p1')).toBe('Newer than the queue');
  });

  it('stores its own typed words, not another tab\'s newer queue entry, while its save is queued', () => {
    const view = render({ content: { p1: 'Typed in tab A' }, modified: { p1: true } });
    act(() => { jest.advanceTimersByTime(300); });
    // A saved offline; tab B queued newer words and kept a still newer draft of its own.
    storeCells({ p1: 'Draft of tab B' });
    view.rerender({ content: { p1: 'Typed in tab A' }, modified: {}, pending: new Set(['p1']), pendingText: { p1: 'Queued in tab B' }, live: new Set(['p1', 'p2']) });
    act(() => { jest.advanceTimersByTime(300); });
    expect(storedCell('p1')).toBe('Draft of tab B');
  });

  it('stops reaching over other drafts once its own edit has settled', () => {
    const view = render({ content: { p1: 'Typed here' }, modified: { p1: true } });
    act(() => { jest.advanceTimersByTime(300); });
    // Saved and confirmed: neither edited nor queued any more.
    view.rerender({ content: { p1: 'Typed here' }, modified: {}, pending: new Set(), live: new Set(['p1', 'p2']) });
    act(() => { jest.advanceTimersByTime(300); });
    // Another tab queues its words and keeps a newer draft of them.
    storeCells({ p1: 'Newer in another tab' });
    view.rerender({ content: { p1: 'Typed here' }, modified: {}, pending: new Set(['p1']), pendingText: { p1: 'Queued in another tab' }, live: new Set(['p1', 'p2']) });
    act(() => { jest.advanceTimersByTime(300); });
    expect(storedCell('p1')).toBe('Newer in another tab');
  });

  it('does not bring back a queued orphan the person let go', () => {
    storeCells({ gone: 'Orphan words' });
    const view = render({ content: { gone: 'Orphan words' }, pending: new Set(['gone']), pendingText: { gone: 'Orphan words' } });
    act(() => { jest.advanceTimersByTime(300); });
    act(() => { view.result.current.forget({ gone: 'Orphan words' }); });
    view.rerender({ content: {}, modified: {}, pending: new Set(['gone']), pendingText: { gone: 'Orphan words' }, live: new Set(['p1', 'p2']) });
    act(() => { jest.advanceTimersByTime(300); });
    view.unmount();
    expect(storedCell('gone')).toBeUndefined();
  });

  it('keeps storing what was typed here after the queue takes it over', () => {
    storeCells({ p1: 'Found at open' });
    const view = render({ content: { p1: 'Typed here' }, modified: { p1: true } });
    // Saved offline before the debounce: the cell is queued and no longer marked as edited.
    view.rerender({ content: { p1: 'Typed here' }, modified: {}, pending: new Set(['p1']), pendingText: { p1: 'Typed here' }, live: new Set(['p1', 'p2']) });
    act(() => { jest.advanceTimersByTime(300); });
    expect(storedCell('p1')).toBe('Typed here');
  });
});
