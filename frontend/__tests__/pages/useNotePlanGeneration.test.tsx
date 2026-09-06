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

it('fills only fully empty points and skips points with written children', async () => {
  const view = setup({ sub: 'Already written' });
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { q: '- Next' }, missingMaterial: {} });
  await act(async () => { await view.result.current.fillEmpty(); });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
  expect(generateNotePlanContent).toHaveBeenCalledWith(expect.objectContaining({ outlinePointId: 'q' }), expect.any(AbortSignal));
  expect(view.cells).toEqual({ sub: 'Already written', q: '- Next' });
});

it('prevents double clicks, respects offline/usage blocking, and skips queued writes', async () => {
  const blocked = setup({}, true);
  await act(async () => { await blocked.result.current.generate(point); await blocked.result.current.fillEmpty(); });
  expect(generateNotePlanContent).not.toHaveBeenCalled();
  const view = setup();
  view.options.conspectus.pendingNodeIds.add('p');
  await act(async () => { await view.result.current.generate(point); });
  expect(generateNotePlanContent).not.toHaveBeenCalled();
  view.options.conspectus.pendingNodeIds.clear();
  await act(async () => { await Promise.all([view.result.current.generate(point), view.result.current.generate(point)]); });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
});

it('continues after a point failure but stops a batch on source refusal', async () => {
  const view = setup();
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ contentByNodeId: { q: '- Next' }, missingMaterial: {} });
  await act(async () => { await view.result.current.fillEmpty(); });
  expect(view.result.current.errors.p).toBe('generationFailed');
  expect(view.cells.q).toBe('- Next');
  jest.mocked(generateNotePlanContent).mockClear().mockRejectedValue(new Error('sourceUnavailable'));
  const other = setup();
  await act(async () => { await other.result.current.fillEmpty(); });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
  expect(other.result.current.errors.p).toBe('sourceUnavailable');
});

it('aborts the active request on unmount', async () => {
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise(() => undefined));
  const view = setup();
  act(() => { void view.result.current.generate(point); });
  const signal = jest.mocked(generateNotePlanContent).mock.calls[0][1];
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
