import { act, renderHook } from '@testing-library/react';

import { useNotePlanGeneration } from '@/(pages)/(private)/sermons/[id]/plan/manual/useNotePlanGeneration';
import { generateNotePlanContent } from '@/(pages)/(private)/sermons/[id]/plan/planApi';

import type { ManualConspectus } from '@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus';
import type { Sermon } from '@/models/models';
import type { NotePlanResult } from '@/utils/notePlan';

jest.mock('@/(pages)/(private)/sermons/[id]/plan/planApi', () => ({ generateNotePlanContent: jest.fn() }));

const point = { id: 'p', text: 'Point', note: 'List examples', subPoints: [{ id: 'sub', text: 'Detail', position: 0 }] };
const sermon: Sermon = { id: 's', userId: 'u', title: 'Title', verse: '', date: '', thoughts: [], sourceNoteIds: ['n'],
  outline: { introduction: [], main: [point, { id: 'q', text: 'Next point' }], conclusion: [] } };
const generated = { contentByNodeId: { p: '- New', sub: '- Detail' }, missingMaterial: {} };

function setup(initial: Record<string, string> = {}, blocked = false) {
  const cells = { ...initial };
  const restoreCells = jest.fn((incoming: Record<string, string>) => Object.assign(cells, incoming));
  const conspectus = { contentByNodeId: cells, pendingNodeIds: new Set(), restoreCells } as unknown as ManualConspectus;
  const options = { sermon, conspectus, blocked };
  const hook = renderHook(() => useNotePlanGeneration(options));
  return { ...hook, options, cells, restoreCells };
}

beforeEach(() => { jest.resetAllMocks(); jest.mocked(generateNotePlanContent).mockResolvedValue(generated); });

it('reviews a proposal without changing existing text, then accepts it into the editable draft', async () => {
  const view = setup({ p: 'My writing' });
  await act(async () => { await view.result.current.generate(point); });
  expect(view.cells.p).toBe('My writing');
  expect(view.result.current.proposals.p.contentByNodeId.sub).toBe('- Detail');
  act(() => { view.result.current.accept('p'); });
  expect(view.cells).toEqual({ p: '- New', sub: '- Detail' });
  expect(view.result.current.proposals.p).toBeUndefined();
});

it.each(['text', 'outline', 'sermon'])('protects a %s change while generation runs', async (change) => {
  let resolve!: (value: NotePlanResult) => void;
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise((done) => { resolve = done; }));
  const view = setup();
  let request!: Promise<void>;
  act(() => { request = view.result.current.generate(point); });
  if (change === 'text') view.cells.p = 'Typed while waiting';
  if (change === 'outline') view.options.sermon = { ...sermon, title: 'Revised topic' };
  if (change === 'sermon') view.options.sermon = { ...sermon, id: 'another' };
  view.rerender();
  await act(async () => { resolve(generated); await request; });
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.result.current.errors.p).toBe('contextChanged');
});

it('rechecks edits made after the proposal arrived before applying it', async () => {
  const view = setup();
  await act(async () => { await view.result.current.generate(point); });
  view.cells.sub = 'New manual text';
  act(() => { view.result.current.accept('p'); });
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.result.current.errors.p).toBe('contextChanged');
});

it('keeps existing text when the source lacks evidence and permits discarding the proposal', async () => {
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { p: '', sub: '- Detail' }, missingMaterial: { p: 'No evidence' } });
  const view = setup({ p: 'Keep me' });
  await act(async () => { await view.result.current.generate(point); });
  act(() => { view.result.current.accept('p'); });
  expect(view.cells.p).toBe('Keep me');
  expect(view.result.current.missing.p).toBe('No evidence');
  await act(async () => { await view.result.current.generate(point); });
  act(() => view.result.current.discard('p'));
  expect(view.result.current.proposals.p).toBeUndefined();
});

it('prevents double clicks, respects offline/usage blocking, and skips queued writes', async () => {
  const blocked = setup({}, true);
  await act(async () => { await blocked.result.current.generate(point); });
  expect(generateNotePlanContent).not.toHaveBeenCalled();
  const view = setup();
  view.options.conspectus.pendingNodeIds.add('p');
  await act(async () => { await view.result.current.generate(point); });
  expect(generateNotePlanContent).not.toHaveBeenCalled();
  view.options.conspectus.pendingNodeIds.clear();
  await act(async () => { await Promise.all([view.result.current.generate(point), view.result.current.generate(point)]); });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
});

it('keeps a failure local while another point succeeds and permits retry', async () => {
  const view = setup();
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ contentByNodeId: { q: '- Next' }, missingMaterial: {} });
  await act(async () => { await Promise.all([view.result.current.generate(point), view.result.current.generate(sermon.outline!.main[1])]); });
  expect(view.result.current.errors.p).toBe('generationFailed');
  expect(view.result.current.proposals.q.contentByNodeId.q).toBe('- Next');
  expect(view.result.current.busy).toBe(false);
  jest.mocked(generateNotePlanContent).mockResolvedValueOnce(generated);
  await act(async () => { await view.result.current.generate(point); });
  expect(view.result.current.errors.p).toBeUndefined();
  expect(view.result.current.proposals.p.contentByNodeId.p).toBe('- New');
});

it('aborts every active request on unmount', async () => {
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise(() => undefined));
  const view = setup();
  act(() => { void view.result.current.generate(point); });
  act(() => { void view.result.current.generate(sermon.outline!.main[1]); });
  const signals = jest.mocked(generateNotePlanContent).mock.calls.map((call) => call[1]);
  expect(signals).toHaveLength(2);
  view.unmount();
  signals.forEach((signal) => expect(signal?.aborted).toBe(true));
});

it('runs different points together and keeps their results isolated when they finish out of order', async () => {
  const resolve: Record<string, (value: NotePlanResult) => void> = {};
  jest.mocked(generateNotePlanContent).mockImplementation(({ outlinePointId }) => new Promise((done) => { resolve[outlinePointId] = done; }));
  const view = setup();
  const next = sermon.outline!.main[1];
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = view.result.current.generate(point);
    second = view.result.current.generate(next);
    void view.result.current.generate(point);
  });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(2);
  expect(view.result.current.generatingIds).toEqual({ p: true, q: true });
  await act(async () => { resolve.q({ contentByNodeId: { q: '- Next' }, missingMaterial: {} }); await second; });
  expect(view.result.current.proposals.q.contentByNodeId).toEqual({ q: '- Next' });
  expect(view.result.current.proposals.p).toBeUndefined();
  expect(view.result.current.generatingIds).toEqual({ p: true });
  expect(view.result.current.busy).toBe(true);
  await act(async () => { resolve.p(generated); await first; });
  expect(view.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
  act(() => { view.result.current.accept('q'); view.result.current.accept('p'); });
  expect(view.cells).toEqual({ q: '- Next', ...generated.contentByNodeId });
});

it('refreshes quota after a cap refusal without leaking refresh errors into a point', async () => {
  const view = setup();
  const refresh = jest.fn().mockRejectedValue(new Error('Refresh unavailable'));
  Object.assign(view.options, { onSuccess: refresh });
  view.rerender();
  jest.mocked(generateNotePlanContent).mockRejectedValue(Object.assign(new Error('Cap reached'), { code: 'USAGE_CAP_REACHED' }));
  await act(async () => { await view.result.current.generate(point); });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(view.result.current.errors.p).toBe('usageBlocked');
  expect(view.result.current.busy).toBe(false);
});

it.each(['resolve', 'reject'])('ignores a late %s after unmount and refuses another request', async (outcome) => {
  let resolve!: (value: NotePlanResult) => void;
  let reject!: (error: Error) => void;
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
  const view = setup();
  const generate = view.result.current.generate;
  let request!: Promise<void>;
  act(() => { request = generate(point); });
  view.unmount();
  await act(async () => {
    if (outcome === 'resolve') resolve(generated);
    else reject(new Error('Cancelled'));
    await request;
    await generate(point);
  });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
  expect(view.restoreCells).not.toHaveBeenCalled();
});

it.each([{ p: '- Missing child' }, { p: '- Parent', foreign: '- Wrong child' }])('rejects a malformed node result %j', async (contentByNodeId) => {
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId, missingMaterial: {} } as NotePlanResult);
  const view = setup();
  await act(async () => { await view.result.current.generate(point); });
  expect(view.result.current.proposals.p).toBeUndefined();
  expect(view.result.current.errors.p).toBe('generationFailed');
  expect(view.result.current.busy).toBe(false);
});

it('does not request a removed point or accept a missing proposal', async () => {
  const view = setup();
  await act(async () => { await view.result.current.generate({ id: 'gone', text: 'Removed' }); });
  expect(generateNotePlanContent).not.toHaveBeenCalled();
  expect(view.result.current.busy).toBe(false);
  act(() => { expect(view.result.current.accept('gone')).toBe(false); });
  expect(view.restoreCells).not.toHaveBeenCalled();
});

it('regenerates only the selected child and preserves concurrent writing in its parent', async () => {
  const view = setup({ p: 'Parent draft', sub: 'Child draft' });
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- New child' }, missingMaterial: {} });
  await act(async () => { await view.result.current.generate(point, 'sub'); });
  expect(generateNotePlanContent).toHaveBeenCalledWith(expect.objectContaining({ outlinePointId: 'p', targetNodeId: 'sub' }), expect.any(AbortSignal));
  expect(view.cells).toEqual({ p: 'Parent draft', sub: 'Child draft' });
  view.cells.p = 'Parent edited during review';
  act(() => { expect(view.result.current.accept('sub')).toBe(true); });
  expect(view.restoreCells).toHaveBeenCalledWith({ sub: '- New child' });
  expect(view.cells).toEqual({ p: 'Parent edited during review', sub: '- New child' });
});

it('does not overwrite a child edited after its targeted proposal arrived', async () => {
  const view = setup({ sub: 'Original' });
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- New' }, missingMaterial: {} });
  await act(async () => { await view.result.current.generate(point, 'sub'); });
  view.cells.sub = 'Manual correction';
  act(() => { expect(view.result.current.accept('sub')).toBe(false); });
  expect(view.result.current.errors.sub).toBe('contextChanged');
  expect(view.restoreCells).not.toHaveBeenCalled();
});

it('runs sibling targets concurrently, blocks overlapping whole-point requests and accepts out of order', async () => {
  const view = setup({ p: 'Parent', sub: 'First', sibling: 'Second' });
  const parent = { ...point, subPoints: [...point.subPoints, { id: 'sibling', text: 'Another detail', position: 1 }] };
  view.options.sermon = { ...sermon, outline: { introduction: [], main: [parent], conclusion: [] } };
  view.rerender();
  const resolve: Record<string, (result: NotePlanResult) => void> = {};
  jest.mocked(generateNotePlanContent).mockImplementation(({ targetNodeId }) => new Promise((done) => { resolve[targetNodeId!] = done; }));
  let first!: Promise<void>; let second!: Promise<void>;
  act(() => {
    first = view.result.current.generate(parent, 'sub');
    second = view.result.current.generate(parent, 'sibling');
    void view.result.current.generate(parent);
    void view.result.current.generate(parent, 'sub');
  });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(2);
  expect(view.result.current.generatingIds).toEqual({ sub: true, sibling: true });
  await act(async () => { resolve.sibling({ contentByNodeId: { sibling: '- Second' }, missingMaterial: {} }); await second; });
  act(() => { view.result.current.accept('sibling'); });
  await act(async () => { resolve.sub({ contentByNodeId: { sub: '- First' }, missingMaterial: {} }); await first; });
  act(() => { view.result.current.accept('sub'); });
  expect(view.cells).toEqual({ p: 'Parent', sub: '- First', sibling: '- Second' });
});

it('blocks a child request while its whole point is generating', () => {
  const view = setup();
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise(() => undefined));
  act(() => { void view.result.current.generate(point); void view.result.current.generate(point, 'sub'); });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
});

it('supersedes an overlapping whole-point proposal when requesting one child', async () => {
  const view = setup();
  await act(async () => { await view.result.current.generate(point); });
  expect(view.result.current.proposals.p).toBeDefined();
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- Child only' }, missingMaterial: {} });
  await act(async () => { await view.result.current.generate(point, 'sub'); });
  expect(view.result.current.proposals.p).toBeUndefined();
  expect(view.result.current.proposals.sub).toBeDefined();
  jest.mocked(generateNotePlanContent).mockResolvedValue(generated);
  await act(async () => { await view.result.current.generate(point); });
  expect(view.result.current.proposals.sub).toBeUndefined();
  expect(view.result.current.proposals.p).toBeDefined();
});

it('rejects a widened child response and foreign missing-material keys', async () => {
  const view = setup();
  await act(async () => { await view.result.current.generate(point, 'sub'); });
  expect(view.result.current.errors.sub).toBe('generationFailed');
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- Valid' }, missingMaterial: { p: 'Outside scope' } });
  await act(async () => { await view.result.current.generate(point, 'sub'); });
  expect(view.result.current.proposals.sub).toBeUndefined();
  expect(view.restoreCells).not.toHaveBeenCalled();
});

it('skips removed subpoints and ignores queued sibling writes for a targeted request', async () => {
  const view = setup();
  await act(async () => { await view.result.current.generate(point, 'gone'); });
  expect(generateNotePlanContent).not.toHaveBeenCalled();
  view.options.conspectus.pendingNodeIds.add('p');
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- Only child' }, missingMaterial: {} });
  await act(async () => { await view.result.current.generate(point, 'sub'); });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
});

it('captures current selected draft content with a revision and closes the composer only on success', async () => {
  const view = setup({ p: 'Parent', sub: 'Unsaved child' });
  act(() => { view.result.current.setRefining('sub', true); });
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(new Error('network'));
  const intent = { instruction: 'Keep the cue, update references', mode: 'references' as const };
  await act(async () => { await view.result.current.generate(point, 'sub', intent); });
  expect(view.result.current.refiningIds.sub).toBe(true);
  expect(view.cells.sub).toBe('Unsaved child');
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- Refined' }, missingMaterial: {} });
  await act(async () => { await view.result.current.generate(point, 'sub', intent); });
  expect(generateNotePlanContent).toHaveBeenLastCalledWith(expect.objectContaining({ revision: { ...intent, currentContentByNodeId: { sub: 'Unsaved child' } } }), expect.any(AbortSignal));
  expect(view.result.current.refiningIds.sub).toBe(false);
  expect(view.cells.sub).toBe('Unsaved child');
  act(() => { view.result.current.accept('sub'); });
  expect(view.cells).toEqual({ p: 'Parent', sub: '- Refined' });
});
