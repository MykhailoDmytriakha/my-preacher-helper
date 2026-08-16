import { act, renderHook, waitFor } from '@testing-library/react';

import { useManualConspectus } from '@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus';
import { OfflineQueuedError, StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { enqueueWrite, listOutbox, newIntentId, removeFromOutbox } from '@/services/writeOutbox.client';

import type { Sermon } from '@/models/models';

/**
 * THE HAND-WRITTEN PLAN AFTER THE STORAGE CHANGE.
 *
 * Text now lives under `planText.<nodeId>`, written one key at a time, and the assembled
 * document is not stored at all. Two whole classes of test disappeared with that change,
 * and their absence is the point:
 *
 *   - "two saves race and one is lost" — a leaf write cannot touch a neighbouring key, so
 *     the queue, the carry-forward and their tests are gone. What remains is the guard
 *     below: a save must not MENTION another node's key.
 *   - "the stored document still shows a deleted heading" — nothing stores a document.
 *
 * What still needs holding is the ORDER of the two writes a deletion makes, because each
 * order loses something different when the second write fails.
 */

const mockUpdateSermonOutline = jest.fn();
const mockUpdateThought = jest.fn();
const mockSavePlanText = jest.fn();
const mockToastError = jest.fn();

jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: (...args: unknown[]) => mockUpdateSermonOutline(...args),
}));

// The real module with only the write replaced — see the note in usePlanActions.test.ts.
jest.mock('@/services/sermons.client', () => ({
  ...jest.requireActual('@/services/sermons.client'),
  savePlanTextViaClient: (...args: unknown[]) => mockSavePlanText(...args),
}));

jest.mock('@/services/thought.service', () => ({
  updateThought: (...args: unknown[]) => mockUpdateThought(...args),
}));

jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

const sermonWithText = (): Sermon => ({
  id: 'sermon-1',
  title: 'Test Sermon',
  verse: '',
  date: new Date('2026-01-01').toISOString(),
  userId: 'user-1',
  thoughts: [],
  outline: {
    introduction: [
      {
        id: 'point-1',
        text: 'First point',
        subPoints: [{ id: 'sub-1', text: 'First sub-point', position: 1000 }],
      },
    ],
    main: [],
    conclusion: [],
  },
  planText: { 'point-1': 'Point text', 'sub-1': 'Sub-point text' },
} as unknown as Sermon);

const sermonWithTwoPoints = (): Sermon => ({
  id: 'sermon-2',
  title: 'Two points',
  verse: '',
  date: new Date('2026-01-01').toISOString(),
  userId: 'user-1',
  thoughts: [],
  outline: {
    introduction: [
      { id: 'point-a', text: 'Point A' },
      { id: 'point-b', text: 'Point B' },
    ],
    main: [],
    conclusion: [],
  },
  planText: {},
} as unknown as Sermon);

const renderConspectus = (sermon: Sermon) => {
  let current = sermon;
  const setSermon = jest.fn((updater: (previous: Sermon | null) => Sermon | null) => {
    const next = updater(current);
    if (next) current = next;
    return next;
  });
  const t = (key: string) => key;

  const view = renderHook(() => useManualConspectus({ sermon: current, setSermon, t }));
  return { view, setSermon, latest: () => current };
};

beforeEach(() => {
  jest.clearAllMocks();
  // The outbox is real storage shared across tests; a leftover intent would keep a cell held.
  listOutbox().forEach((entry) => removeFromOutbox(entry.id));
  mockSavePlanText.mockResolvedValue(undefined);
  mockUpdateSermonOutline.mockImplementation(async (_id: string, next: unknown) => next);
  mockUpdateThought.mockResolvedValue({});
});

describe('useManualConspectus writes', () => {
  it('sends only the nodes of the card being saved', async () => {
    const { view } = renderConspectus(sermonWithTwoPoints());

    act(() => {
      view.result.current.setNodeContent('point-a', 'Text for A');
      view.result.current.setNodeContent('point-b', 'Text for B');
    });

    await act(async () => {
      await view.result.current.savePoint('point-a', 'introduction', ['point-a']);
    });

    const [, changedText] = mockSavePlanText.mock.calls[0];
    expect(changedText).toEqual({ 'point-a': 'Text for A' });
    // The other card is not mentioned, so storage cannot overwrite it — the property that
    // made the write queue unnecessary.
    expect(Object.keys(changedText)).not.toContain('point-b');
  });

  it('keeps a cell dirty when its text changed while the save was in flight', async () => {
    let release: (() => void) | undefined;
    mockSavePlanText.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));

    const { view } = renderConspectus(sermonWithText());
    act(() => { view.result.current.setNodeContent('point-1', 'First version'); });

    let saving: Promise<void> | undefined;
    await act(async () => {
      saving = view.result.current.savePoint('point-1', 'introduction', ['point-1']);
      // Writes are ordered now, so the request leaves on the next microtask — wait for it
      // to actually be in flight before typing over it.
      await waitFor(() => expect(mockSavePlanText).toHaveBeenCalled());
    });

    // Typed while the request was still out.
    act(() => { view.result.current.setNodeContent('point-1', 'Second version'); });

    await act(async () => { release?.(); await saving; });

    expect(view.result.current.modifiedNodeIds['point-1']).toBe(true);
  });
});

describe('useManualConspectus deletions', () => {
  it('keeps the point text when the structure write fails', async () => {
    mockUpdateSermonOutline.mockRejectedValue(new Error('structure write refused'));

    const { view } = renderConspectus(sermonWithText());
    await act(async () => { await view.result.current.deletePoint('point-1'); });

    await waitFor(() => expect(mockUpdateSermonOutline).toHaveBeenCalled());

    // The point still exists, so its text must be untouched.
    expect(mockSavePlanText).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('errors.failedToSaveOutline');
  });

  it('drops the point keys only after the structure write is accepted', async () => {
    const { view } = renderConspectus(sermonWithText());
    await act(async () => { await view.result.current.deletePoint('point-1'); });

    await waitFor(() => expect(mockSavePlanText).toHaveBeenCalled());

    const [, changedText, removed] = mockSavePlanText.mock.calls[0];
    expect(changedText).toEqual({});
    expect(removed).toEqual(['point-1', 'sub-1']);
  });

  it('rescues the sub-point text before touching the structure', async () => {
    const { view } = renderConspectus(sermonWithText());
    await act(async () => { await view.result.current.deleteSubPoint('point-1', 'sub-1'); });

    await waitFor(() => expect(mockSavePlanText).toHaveBeenCalled());

    /**
     * ONE WRITE CARRIES BOTH HALVES — the rescue into the parent and the emptying of the
     * sub-point. Split across two writes, a failure in between left the words in BOTH places,
     * and a retry added them again; offline it was worse, because only the first half was
     * queued and the replay later merged the text into a parent whose sub-point still stood.
     * The empty key is swept afterwards, and that sweep is free to fail.
     */
    const [, changedText, removed] = mockSavePlanText.mock.calls[0];
    expect(changedText['point-1']).toContain('Point text');
    expect(changedText['point-1']).toContain('Sub-point text');
    expect(changedText['sub-1']).toBe('');
    expect(removed ?? []).toEqual([]);

    const [, sweptText, sweptKeys] = mockSavePlanText.mock.calls.at(-1)!;
    expect(sweptText).toEqual({});
    expect(sweptKeys).toEqual(['sub-1']);
  });

  it('keeps the rescued sub-point text when the structure write fails', async () => {
    mockUpdateSermonOutline.mockRejectedValue(new Error('structure write refused'));

    const { view } = renderConspectus(sermonWithText());
    await act(async () => { await view.result.current.deleteSubPoint('point-1', 'sub-1'); });

    await waitFor(() => expect(mockUpdateSermonOutline).toHaveBeenCalled());

    // The rescue landed first, so the words survive even though the sub-point stays.
    const [, changedText] = mockSavePlanText.mock.calls[0];
    expect(changedText['point-1']).toContain('Sub-point text');
  });

  it('releases every thought that pointed at a deleted point', async () => {
    const sermon = {
      ...sermonWithText(),
      thoughts: [
        { id: 'th-1', text: 'On the point', tags: [], date: '', outlinePointId: 'point-1' },
        { id: 'th-2', text: 'On the sub-point', tags: [], date: '', outlinePointId: 'point-1', subPointId: 'sub-1' },
        { id: 'th-3', text: 'Elsewhere', tags: [], date: '', outlinePointId: 'other' },
      ],
    } as unknown as Sermon;

    const { view } = renderConspectus(sermon);
    await act(async () => { await view.result.current.deletePoint('point-1'); });

    await waitFor(() => expect(mockUpdateThought).toHaveBeenCalled());

    const detached = mockUpdateThought.mock.calls.map((call) => call[1]);
    expect(detached.map((thought) => thought.id).sort()).toEqual(['th-1', 'th-2']);
    detached.forEach((thought) => {
      expect(thought.outlinePointId).toBeNull();
      expect(thought.subPointId).toBeNull();
    });
  });

  it('releases only the sub-point link when a sub-point goes', async () => {
    const sermon = {
      ...sermonWithText(),
      thoughts: [
        { id: 'th-2', text: 'On the sub-point', tags: [], date: '', outlinePointId: 'point-1', subPointId: 'sub-1' },
      ],
    } as unknown as Sermon;

    const { view } = renderConspectus(sermon);
    await act(async () => { await view.result.current.deleteSubPoint('point-1', 'sub-1'); });

    await waitFor(() => expect(mockUpdateThought).toHaveBeenCalled());

    const detached = mockUpdateThought.mock.calls.map((call) => call[1]);
    expect(detached).toHaveLength(1);
    expect(detached[0].subPointId).toBeNull();
    // It still belongs to its point — only the grouping under it is gone.
    expect(detached[0].outlinePointId).toBe('point-1');
  });
});

describe('useManualConspectus saveModified', () => {
  it('persists the cells still holding unsaved text', async () => {
    const { view } = renderConspectus(sermonWithText());
    act(() => { view.result.current.setNodeContent('point-1', 'Typed and never saved'); });

    let outcome: boolean | undefined;
    await act(async () => { outcome = await view.result.current.saveModified(); });

    expect(outcome).toBe(true);
    const [, changedText] = mockSavePlanText.mock.calls.at(-1)!;
    expect(changedText['point-1']).toBe('Typed and never saved');
  });

  it('reports refusal so the caller can stay put', async () => {
    mockSavePlanText.mockRejectedValue(new Error('refused'));

    const { view } = renderConspectus(sermonWithText());
    act(() => { view.result.current.setNodeContent('point-1', 'Typed and never saved'); });

    let outcome: boolean | undefined;
    await act(async () => { outcome = await view.result.current.saveModified(); });

    expect(outcome).toBe(false);
  });

  it('writes nothing when there is nothing unsaved', async () => {
    const { view } = renderConspectus(sermonWithText());

    let outcome: boolean | undefined;
    await act(async () => { outcome = await view.result.current.saveModified(); });

    expect(outcome).toBe(true);
    expect(mockSavePlanText).not.toHaveBeenCalled();
  });
});

/**
 * A KEY SENT IS A KEY OVERWRITTEN.
 *
 * Leaf paths protect a neighbouring cell only while the neighbour stays OUT of the payload.
 * Sending every cell of a point looked harmless — separate keys — but it destroyed a
 * sub-point edited on another device: pressing Save on the parent carried this screen's
 * stale copy of the sub-point along with it.
 */
describe('saving sends only what changed here', () => {
  const withSubPoint = () => sermonWithText();

  it('leaves an untouched sub-point out of the payload', async () => {
    const { view } = renderConspectus(withSubPoint());

    act(() => { view.result.current.setNodeContent('point-1', 'Edited parent'); });

    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1', 'sub-1']);
    });

    const [, changedText] = mockSavePlanText.mock.calls.at(-1)!;
    expect(changedText).toEqual({ 'point-1': 'Edited parent' });
    // The sub-point was not edited here, so it must not be written over.
    expect(Object.keys(changedText)).not.toContain('sub-1');
  });

  it('still writes the point itself when nothing was modified', async () => {
    const { view } = renderConspectus(withSubPoint());

    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1', 'sub-1']);
    });

    const [, changedText] = mockSavePlanText.mock.calls.at(-1)!;
    expect(Object.keys(changedText)).toEqual(['point-1']);
  });
});

/**
 * LEAVING MUST NOT DECLARE VICTORY OVER TEXT IT DID NOT SAVE.
 *
 * The navigation guard travels on `true`. If someone types while the write is in flight,
 * that newer text was never sent — and answering `true` walked away from it.
 */
describe('saveModified answers with the real state', () => {
  it('reports false when text was typed while the save was in flight', async () => {
    let release: (() => void) | undefined;
    mockSavePlanText.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));

    const { view } = renderConspectus(sermonWithText());
    act(() => { view.result.current.setNodeContent('point-1', 'First version'); });

    let saving: Promise<boolean> | undefined;
    await act(async () => {
      saving = view.result.current.saveModified();
      await waitFor(() => expect(mockSavePlanText).toHaveBeenCalled());
    });
    act(() => { view.result.current.setNodeContent('point-1', 'Second version'); });

    let outcome: boolean | undefined;
    await act(async () => { release?.(); outcome = await saving; });

    expect(outcome).toBe(false);
  });

  it('still reports true when nothing changed mid-flight', async () => {
    const { view } = renderConspectus(sermonWithText());
    act(() => { view.result.current.setNodeContent('point-1', 'Only version'); });

    let outcome: boolean | undefined;
    await act(async () => { outcome = await view.result.current.saveModified(); });

    expect(outcome).toBe(true);
  });
});

/**
 * THE SECOND EDIT MUST NOT LOSE TO THE FIRST.
 *
 * Pressing Save twice does not queue two requests politely: without ordering, the answers
 * can arrive in either order and the OLDER text lands last, overwriting the newer one —
 * while the newer edit has already been marked clean, so nothing looks wrong. This is a
 * one-device, one-person defect, which is why it blocked shipping.
 */
describe('overlapping saves of the same node', () => {
  it('writes the newest text last, not the one pressed first', async () => {
    let releaseFirst: (() => void) | undefined;
    mockSavePlanText.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));

    const { view } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'Version A'); });

    let firstSave: Promise<void> | undefined;
    await act(async () => {
      firstSave = view.result.current.savePoint('point-1', 'introduction', ['point-1']);
      await waitFor(() => expect(mockSavePlanText).toHaveBeenCalled());
    });

    // Typed again and pressed Save again while the first request is still out.
    act(() => { view.result.current.setNodeContent('point-1', 'Version B'); });
    let secondSave: Promise<void> | undefined;
    act(() => { secondSave = view.result.current.savePoint('point-1', 'introduction', ['point-1']); });

    await act(async () => {
      releaseFirst?.();
      await Promise.all([firstSave, secondSave]);
    });

    // Whatever the order of the answers, the LAST thing written is the newest text.
    const [, lastPayload] = mockSavePlanText.mock.calls.at(-1)!;
    expect(lastPayload['point-1']).toBe('Version B');
    expect(view.result.current.contentByNodeId['point-1']).toBe('Version B');
  });
});

/**
 * WHAT THE SAVE VOUCHES FOR.
 *
 * Separate keys stop one card from erasing another; they do nothing about two devices editing
 * THE SAME card. That is settled by stating what the server held when this screen took the
 * cell, and the service refuses when the two disagree — so the screen's only job is to state
 * it truthfully, which is what these hold.
 */
describe('useManualConspectus states what it started from', () => {
  it('vouches for the stored text of the cell it is about to replace', async () => {
    const { view } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'My rewrite'); });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    const [, , , context] = mockSavePlanText.mock.calls[0];
    expect(context).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        baselineByNodeId: { 'point-1': 'Point text' },
      })
    );
  });

  /**
   * A CELL NOBODY HAS EVER WRITTEN IS STATED AS `null`, NOT LEFT OUT. Omitting it drops that
   * field from the comparison, so a card created on another device between opening this screen
   * and pressing Save would be overwritten without a word.
   */
  it('states an untouched cell as nothing rather than saying nothing about it', async () => {
    const { view } = renderConspectus(sermonWithTwoPoints());

    act(() => { view.result.current.setNodeContent('point-a', 'First words'); });
    await act(async () => {
      await view.result.current.savePoint('point-a', 'introduction', ['point-a']);
    });

    const [, , , context] = mockSavePlanText.mock.calls[0];
    expect(context.baselineByNodeId).toEqual({ 'point-a': null });
  });

  /**
   * AFTER A CONFIRMED SAVE THE BASELINE IS WHAT WAS WRITTEN. Left at the opening value, this
   * screen's own second edit would be refused as if a stranger had made the first.
   */
  it('advances the baseline once the server has accepted the text', async () => {
    const { view } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'First version'); });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    act(() => { view.result.current.setNodeContent('point-1', 'Second version'); });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    const [, , , context] = mockSavePlanText.mock.calls.at(-1)!;
    expect(context.baselineByNodeId).toEqual({ 'point-1': 'First version' });
  });

  /**
   * THE MIRROR HOLDS WHAT STORAGE HOLDS. Copying the merged read back into `planText` made
   * every legacy cell look written after any save at all, and `renderPlanWithFallback` reads
   * exactly that flag before serving an old sermon's assembled section — so one save blanked
   * every section nobody had touched yet.
   */
  it('never folds the legacy cells into the stored map', async () => {
    const legacy = {
      ...sermonWithTwoPoints(),
      planText: {},
      plan: {
        introduction: { outline: 'Old assembled introduction', outlinePoints: { 'point-b': 'Old B' } },
        main: { outline: '', outlinePoints: {} },
        conclusion: { outline: '', outlinePoints: {} },
      },
    } as unknown as Sermon;
    const { view, latest } = renderConspectus(legacy);

    act(() => { view.result.current.setNodeContent('point-a', 'New A'); });
    await act(async () => {
      await view.result.current.savePoint('point-a', 'introduction', ['point-a']);
    });

    expect(latest().planText).toEqual({ 'point-a': 'New A' });
  });
});

/**
 * NO CONNECTION IS NOT A REFUSAL.
 *
 * A transaction cannot run without a server, so the guard stores the intent in the durable
 * outbox and says so by THROWING `OfflineQueuedError`. Read as a failure — which every catch
 * block here did by default — that turns a successfully stored edit into a red toast, keeps
 * the cells marked unsaved forever, and blocks the way out of the page with a browser prompt
 * about work that is already safe.
 */
/**
 * A REFUSAL MUST BE AN ANSWER, NOT A WALL.
 *
 * Refusing a stale save protects the other device — and, left there, traps this one: the screen
 * still vouches for the value it opened with, so every further press recreates the same
 * conflict. The person's only way out was copying their text somewhere and reloading, which is
 * exactly the "silently lost your own" the guard's own precondition warns about.
 */
describe('useManualConspectus after a refusal', () => {
  const refusal = (theirs: string) =>
    new StaleWriteError('plan', 0, 3, { 'planText.point-1': theirs });

  /** The action the refusal message offers; pressing it is the only way to overwrite. */
  const keepMineAction = () => {
    const call = mockToastError.mock.calls.find(([key]) => key === 'plan.saveRefusedByOtherDevice');
    return (call?.[1] as { action?: { onClick: () => void } } | undefined)?.action;
  };

  it('keeps the text on screen and still marked unsaved', async () => {
    mockSavePlanText.mockRejectedValueOnce(refusal('Written on the phone'));
    const { view } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'My version'); });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    expect(view.result.current.contentByNodeId['point-1']).toBe('My version');
    expect(view.result.current.modifiedNodeIds['point-1']).toBe(true);
    expect(mockToastError).toHaveBeenCalledWith(
      'plan.saveRefusedByOtherDevice',
      expect.objectContaining({ action: expect.objectContaining({ label: 'plan.saveRefusedKeepMine' }) })
    );
  });

  /**
   * PRESSING SAVE AGAIN MUST NOT BE CONSENT.
   *
   * Adopting the server's values the moment a refusal arrived made "press again to keep yours"
   * true in a way nobody agreed to: two quick presses are BOTH already queued, so the second
   * ran with the freshly adopted baseline and replaced the other device before the warning had
   * even been read. However many times Save is pressed, the baseline must not move on its own.
   */
  it('never adopts the other device\'s version on its own, however many times Save is pressed', async () => {
    mockSavePlanText.mockRejectedValue(refusal('Written on the phone'));
    const { view } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'My version'); });
    await act(async () => {
      await Promise.all([
        view.result.current.savePoint('point-1', 'introduction', ['point-1']),
        view.result.current.savePoint('point-1', 'introduction', ['point-1']),
      ]);
    });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    // Every attempt still vouches for the value this screen opened with — nothing was adopted.
    mockSavePlanText.mock.calls.forEach(([, , , context]) => {
      expect(context.baselineByNodeId).toEqual({ 'point-1': 'Point text' });
    });
    expect(view.result.current.modifiedNodeIds['point-1']).toBe(true);
  });

  it('overwrites only when the person takes the action in the message', async () => {
    mockSavePlanText.mockRejectedValueOnce(refusal('Written on the phone'));
    const { view } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'My version'); });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    await act(async () => { keepMineAction()?.onClick(); });

    const [, changedText, , context] = mockSavePlanText.mock.calls.at(-1)!;
    expect(context.baselineByNodeId).toEqual({ 'point-1': 'Written on the phone' });
    expect(changedText).toEqual({ 'point-1': 'My version' });
    expect(view.result.current.modifiedNodeIds['point-1']).toBe(false);
  });

  /**
   * ONE CELL'S CONFLICT MUST NOT BLOCK THE OTHERS. A departure used to send every unsaved cell
   * in a single transaction, so a card edited on the phone refused paragraphs nobody had
   * touched — and those were then lost on the way out.
   */
  it('saves the cells that are not in conflict on the way out', async () => {
    mockSavePlanText.mockImplementation(async (_id: string, changed: Record<string, string>) => {
      if ('point-1' in changed) throw refusal('Written on the phone');
    });
    const { view } = renderConspectus(sermonWithText());

    act(() => {
      view.result.current.setNodeContent('point-1', 'Conflicted');
      view.result.current.setNodeContent('sub-1', 'Perfectly fine');
    });

    let departed: boolean | undefined;
    await act(async () => { departed = await view.result.current.saveModified(); });

    // The departure is refused — one cell is genuinely unsaved — but the other one is stored.
    expect(departed).toBe(false);
    expect(view.result.current.modifiedNodeIds['sub-1']).toBe(false);
    expect(view.result.current.modifiedNodeIds['point-1']).toBe(true);
  });
});

describe('useManualConspectus when there is no connection', () => {
  /**
   * THE MOCK MUST QUEUE, NOT JUST THROW.
   *
   * `OfflineQueuedError` is only the receipt; the fact is the entry the real service puts in
   * the outbox. Throwing without queuing left the screen's "which cells are still waiting"
   * answer empty, so the hold on the baseline could never engage and the test proved the
   * opposite of what it claimed. A mock that skips the side effect validates the model, not
   * the system.
   */
  const queueOffline = () => {
    mockSavePlanText.mockImplementation(async (
      docId: string,
      changed: Record<string, string>
    ) => {
      enqueueWrite({
        id: newIntentId(),
        uid: 'user-1',
        collection: 'sermons',
        docId,
        aggregate: 'plan',
        patch: Object.fromEntries(
          Object.entries(changed).map(([nodeId, text]) => [`planText.${nodeId}`, text])
        ),
        baseRevision: 0,
        status: 'pending',
        savedAt: 1,
      });
      throw new OfflineQueuedError('plan');
    });
  };

  it('does not report a queued save as a failure', async () => {
    queueOffline();
    const { view } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'Written on the train'); });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    expect(mockToastError).not.toHaveBeenCalled();
    // Nothing claims the server has it either — no success is announced.
    expect(view.result.current.modifiedNodeIds['point-1']).toBe(false);
  });

  /**
   * THE QUEUED TEXT IS MIRRORED, AND THE BASELINE IS WHAT KEEPS THAT HONEST.
   *
   * Not mirroring it was tried and it cost text: after reopening offline the screen showed the
   * OLD paragraph, so the person rewrote it blind and the replay buried the version written on
   * the train. Mirroring alone was also wrong, because the same map is read as "what the server
   * holds". The answer is both — mirror for the eyes, hold the baseline for the guard (see the
   * next test, which is the half that makes this one safe).
   */
  it('keeps the queued text on screen', async () => {
    queueOffline();
    const { view, latest } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'Written on the train'); });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    expect(view.result.current.contentByNodeId['point-1']).toBe('Written on the train');
    expect(latest().planText?.['point-1']).toBe('Written on the train');
  });

  /**
   * BUT THE BASELINE MUST NOT ADVANCE. The server has not accepted anything, and vouching for
   * text it has never seen would hand a later save permission to overwrite whatever the other
   * device stored meanwhile.
   */
  it('still vouches for the last text the server actually confirmed', async () => {
    queueOffline();
    const { view } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'Written on the train'); });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    mockSavePlanText.mockResolvedValue(undefined);
    act(() => { view.result.current.setNodeContent('point-1', 'Back online'); });
    await act(async () => {
      await view.result.current.savePoint('point-1', 'introduction', ['point-1']);
    });

    const [, , , context] = mockSavePlanText.mock.calls.at(-1)!;
    expect(context.baselineByNodeId).toEqual({ 'point-1': 'Point text' });
  });

  it('lets the page be left, because something durable holds the text', async () => {
    queueOffline();
    const { view } = renderConspectus(sermonWithText());

    act(() => { view.result.current.setNodeContent('point-1', 'Written on the train'); });

    let departure: boolean | undefined;
    await act(async () => { departure = await view.result.current.saveModified(); });

    expect(departure).toBe(true);
  });
});
