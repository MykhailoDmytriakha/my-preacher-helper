import { act, renderHook } from '@testing-library/react';

import { useNotePlanGeneration } from '@/(pages)/(private)/sermons/[id]/plan/manual/useNotePlanGeneration';
import { generateNotePlanContent } from '@/(pages)/(private)/sermons/[id]/plan/planApi';
import { beginProposal, resolveProposal } from '@/(pages)/(private)/sermons/[id]/plan/manual/notePlanDrafts.client';

import type { ManualConspectus } from '@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus';
import type { Sermon } from '@/models/models';
import { notePlanContextKey, type NotePlanResult } from '@/utils/notePlan';

jest.mock('@/(pages)/(private)/sermons/[id]/plan/planApi', () => ({ generateNotePlanContent: jest.fn() }));

const point = { id: 'p', text: 'Point', note: 'List examples', subPoints: [{ id: 'sub', text: 'Detail', position: 0 }] };
const sermon: Sermon = { id: 's', userId: 'u', title: 'Title', verse: '', date: '', thoughts: [], sourceNoteIds: ['n'],
  outline: { introduction: [], main: [point, { id: 'q', text: 'Next point' }], conclusion: [] } };
const generated = { contentByNodeId: { p: '- New', sub: '- Detail' }, missingMaterial: {} };

function setup(initial: Record<string, string> = {}, blocked = false, base: Sermon = sermon) {
  const cells = { ...initial };
  const restoreCells = jest.fn((incoming: Record<string, string>) => Object.assign(cells, incoming));
  const saveCells = jest.fn(async (_ids: string[]) => undefined);
  const applyProposal = jest.fn(async (incoming: Record<string, string>) => {
    restoreCells(incoming);
    await saveCells(Object.keys(incoming));
    return true;
  });
  const authored: Record<string, number> = {};
  const draft = { cellAuthoringVersion: (id: string) => authored[id] ?? 0 };
  const conspectus = { contentByNodeId: cells, pendingNodeIds: new Set(), isTransferringText: () => false, applyProposal, draft } as unknown as ManualConspectus;
  const options = { sermon: base, conspectus, blocked };
  const hook = renderHook(() => useNotePlanGeneration(options));
  return { ...hook, options, cells, restoreCells, saveCells, applyProposal, authored };
}

beforeEach(() => { localStorage.clear(); jest.resetAllMocks(); jest.mocked(generateNotePlanContent).mockResolvedValue(generated); });

it('reviews a proposal without changing existing text, then accepts it into the editable draft', async () => {
  const view = setup({ p: 'My writing' });
  await act(async () => { await view.result.current.generate(point); });
  expect(view.cells.p).toBe('My writing');
  expect(view.result.current.proposals.p.contentByNodeId.sub).toBe('- Detail');
  await act(async () => { view.result.current.accept('p'); });
  expect(view.cells).toEqual({ p: '- New', sub: '- Detail' });
  expect(view.result.current.proposals.p).toBeUndefined();
  // Choosing the version is the decision to keep it: the accepted cells are written at once.
  expect(view.saveCells).toHaveBeenCalledWith(['p', 'sub']);
});

it('puts the text into an empty point and saves it without asking for a review', async () => {
  const view = setup();
  await act(async () => { await view.result.current.generate(point); });
  expect(view.cells).toEqual(generated.contentByNodeId);
  expect(view.saveCells).toHaveBeenCalledWith(['p', 'sub']);
  expect(view.result.current.proposals.p).toBeUndefined();
  expect(view.result.current.ready).toHaveLength(0);
});

/** A ready answer stored as an earlier visit or another tab left it. */
function storedAnswer(contentByNodeId: Record<string, string>, autoApply?: boolean, targetNodeId?: string) {
  const scope = { owner: 'u', sermonId: 's' };
  const before = Object.fromEntries(Object.keys(contentByNodeId).map(id => [id, '']));
  const draft = beginProposal(scope, {
    request: { outlinePointId: 'p', targetNodeId, style: 'memory', expectedContext: notePlanContextKey(sermon, 'p') },
    before, labels: Object.fromEntries(Object.keys(before).map(id => [id, id])), ...(autoApply !== undefined && { autoApply }),
  })!;
  resolveProposal(scope, { ...draft, state: 'ready', result: { contentByNodeId, missingMaterial: {} } });
  return draft.id;
}

it('leaves an answer that waited from an earlier visit as a choice when the plan opens — nothing lands unasked', async () => {
  storedAnswer({ p: '- From before', sub: '- Detail' }, true);
  storedAnswer({ q: '- Older version' });
  const view = setup();
  await act(async () => undefined);
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.result.current.ready).toHaveLength(2);
});

it('keeps a live answer as a choice when another answer for the same cell is already waiting', async () => {
  const child = storedAnswer({ sub: '- Child only' }, true, 'sub');
  const view = setup();
  await act(async () => { await view.result.current.generate(point); });
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.result.current.ready.map(proposal => proposal.id)).toContain(child);
  expect(view.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
});

it('keeps a live answer as a choice when the stored sermon already holds words the editor has not shown yet', async () => {
  const view = setup({}, false, { ...sermon, planText: { p: 'Saved on the phone a moment ago' } } as Sermon);
  await act(async () => { await view.result.current.generate(point); });
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.result.current.proposals.p.contentByNodeId.p).toBe('- New');
});

it('keeps a live answer as a choice when words were typed into the cell and deleted while it ran', async () => {
  let resolve!: (value: NotePlanResult) => void;
  jest.mocked(generateNotePlanContent).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = setup();
  let request!: Promise<void>;
  act(() => { request = view.result.current.generate(point); });
  view.authored.p = 2; // typed, then deleted — the cell reads empty again, but the person wrote there
  await act(async () => { resolve(generated); await request; });
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
});

it('keeps a live answer as a choice while words are being composed (input method, dictation)', async () => {
  let resolve!: (value: NotePlanResult) => void;
  jest.mocked(generateNotePlanContent).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = setup();
  let request!: Promise<void>;
  act(() => { request = view.result.current.generate(point); });
  document.dispatchEvent(new Event('compositionstart'));
  await act(async () => { resolve(generated); await request; });
  document.dispatchEvent(new Event('compositionend'));
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
});

it('fills a cell once when two waiting answers for it come back before the screen shows the first', async () => {
  const scope = { owner: 'u', sermonId: 's' };
  const request = (targetNodeId?: string) => ({ outlinePointId: 'p', targetNodeId, style: 'memory' as const, expectedContext: notePlanContextKey(sermon, 'p') });
  beginProposal(scope, { request: request(), before: { p: '', sub: '' }, labels: { p: 'p', sub: 'sub' }, autoApply: true });
  beginProposal(scope, { request: request('sub'), before: { sub: '' }, labels: { sub: 'sub' }, autoApply: true });
  jest.mocked(generateNotePlanContent).mockImplementation(async ({ targetNodeId }) => (targetNodeId
    ? { contentByNodeId: { sub: '- Child answer' }, missingMaterial: {} } : generated));
  const view = setup();
  view.restoreCells.mockImplementation(() => ({})); // accepted, but the editor shows nothing until the next render
  await act(async () => undefined);
  expect(view.restoreCells).toHaveBeenCalledTimes(1);
  expect(view.result.current.ready).toHaveLength(1);
});

it('keeps a target spinning until both of its checks have ended', async () => {
  const scope = { owner: 'u', sermonId: 's' };
  const draft = () => beginProposal(scope, { request: { outlinePointId: 'p', style: 'memory', expectedContext: 'x' }, before: { p: '' }, labels: { p: 'p' } })!;
  const [first, second] = [draft(), draft()];
  const finish: Record<string, (value: NotePlanResult) => void> = {};
  jest.mocked(generateNotePlanContent).mockImplementation((_, __, operation) => new Promise(done => { finish[operation!.operationId] = done; }));
  const view = setup({ p: 'Mine' });
  await act(async () => undefined);
  expect(view.result.current.generatingIds.p).toBe(true);
  await act(async () => { finish[first.id]({ contentByNodeId: { p: '- One' }, missingMaterial: {} }); });
  expect(view.result.current.generatingIds.p).toBe(true);
  await act(async () => { finish[second.id]({ contentByNodeId: { p: '- Two' }, missingMaterial: {} }); });
  expect(view.result.current.generatingIds.p).toBeUndefined();
});

it('keeps the review when an empty point is only partly empty — the written words stay until chosen', async () => {
  const view = setup({ sub: 'My detail' });
  await act(async () => { await view.result.current.generate(point); });
  expect(view.cells).toEqual({ sub: 'My detail' });
  expect(view.saveCells).not.toHaveBeenCalled();
  expect(view.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
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
  if (change === 'sermon') {
    expect(view.result.current.proposals.p).toBeUndefined();
    expect(view.result.current.errors.p).toBeUndefined();
    // Back on its own sermon, the answer that came in while away waits there as a choice.
    const reopened = setup();
    expect(reopened.result.current.proposals.p?.contentByNodeId).toEqual(generated.contentByNodeId);
    expect(reopened.restoreCells).not.toHaveBeenCalled();
  } else {
    expect(view.result.current.errors.p).toBe('contextChanged');
    expect(view.result.current.proposalChanged(view.result.current.proposals.p)).toBe(true);
  }
});

it('offers the delayed multi-cell proposal when the plan is reopened', async () => {
  let resolve!: (value: NotePlanResult) => void;
  jest.mocked(generateNotePlanContent).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const opening = { p: 'My opening words', sub: 'My detail' };
  const original = setup(opening);
  let request!: Promise<void>;
  act(() => { request = original.result.current.generate(point); });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
  original.unmount();

  await act(async () => { resolve(generated); await request; });

  const reopened = setup(opening);
  expect(reopened.cells).toEqual(opening);
  expect(reopened.result.current.proposals.p?.contentByNodeId).toEqual(generated.contentByNodeId);
  await act(async () => { expect(reopened.result.current.accept('p')).toBe(true); });
  expect(reopened.cells).toEqual(generated.contentByNodeId);
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
});

it('checks and resumes the same request after losing the connection', async () => {
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(new TypeError('Network offline'));
  const original = setup({ p: 'Original' });
  await act(async () => { await original.result.current.generate(point); });
  const [body, , operation] = jest.mocked(generateNotePlanContent).mock.calls[0];
  original.unmount();

  // Reopening asks the server for the stored answer by itself — nobody has to press "Check".
  const unavailable = Object.assign(new Error('Not registered'), { code: 'ai-result-not-started' });
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(unavailable);
  const reopened = setup({ p: 'Original' });
  await act(async () => undefined);
  expect(generateNotePlanContent).toHaveBeenCalledTimes(2);
  expect(generateNotePlanContent).toHaveBeenLastCalledWith(body, undefined, { ...operation, recoverOnly: true });
  const pending = reopened.result.current.pending[0];
  expect(reopened.result.current.canResume(pending)).toBe(true);
  await act(async () => { await reopened.result.current.recover(pending.id, true); });
  expect(generateNotePlanContent).toHaveBeenLastCalledWith(body, undefined, { ...operation, recoverOnly: false });
  expect(reopened.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
});

it('never restarts a request the server did not take when the plan reopens — that would be a new paid request', async () => {
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(new TypeError('Network offline'));
  const original = setup({ p: 'Original' });
  await act(async () => { await original.result.current.generate(point); });
  const unavailable = Object.assign(new Error('Not registered'), { code: 'ai-result-not-started' });
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(unavailable);
  await act(async () => { await original.result.current.recover(original.result.current.pending[0].id); });
  original.unmount();
  setup({ p: 'Original' });
  await act(async () => undefined);
  // Asked again — it may have been registered and finished since — but only for the stored answer.
  expect(generateNotePlanContent).toHaveBeenCalledTimes(3);
  expect(jest.mocked(generateNotePlanContent).mock.calls[2][2]).toEqual(expect.objectContaining({ recoverOnly: true }));
});

it('lets newer words start a new request while an unregistered earlier request stays available to check', async () => {
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(new TypeError('Network offline'));
  const view = setup({ p: 'Original' });
  await act(async () => { await view.result.current.generate(point); });
  const earlier = view.result.current.pending[0];
  const unavailable = Object.assign(new Error('Not registered'), { code: 'ai-result-not-started' });
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(unavailable);
  await act(async () => { await view.result.current.recover(earlier.id); });
  view.cells.p = 'Later writing';
  expect(view.result.current.canResume(view.result.current.pending[0])).toBe(false);
  await act(async () => { await view.result.current.generate(point); });
  expect(view.result.current.pending[0].id).toBe(earlier.id);
  expect(view.result.current.proposals.p.before.p).toBe('Later writing');
  expect(view.result.current.proposals.p.id).not.toBe(earlier.id);
});

it('retains a source-stale result for review and leaves the current words alone', async () => {
  jest.mocked(generateNotePlanContent).mockResolvedValueOnce({ ...generated, sourceChanged: true });
  const original = setup({ p: 'Current' });
  await act(async () => { await original.result.current.generate(point); });
  original.unmount();
  const reopened = setup({ p: 'Current' });
  expect(reopened.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
  await act(async () => { expect(reopened.result.current.accept('p')).toBe(false); });
  expect(reopened.cells.p).toBe('Current');
});

it('keeps the full proposal when the plan has no engine session to accept it', async () => {
  const view = setup({ p: 'Existing point', sub: 'Existing child' });
  Object.assign(view.options.conspectus, { applyProposal: undefined });
  await act(async () => { await view.result.current.generate(point); });
  await act(async () => { expect(view.result.current.accept('p')).toBe(false); });
  expect(view.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
  expect(view.cells).toEqual({ p: 'Existing point', sub: 'Existing child' });
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.saveCells).not.toHaveBeenCalled();
});

it('keeps the full proposal if the editor cannot back up every accepted cell', async () => {
  const view = setup({ p: 'Existing point', sub: 'Existing child' });
  view.applyProposal.mockRejectedValueOnce(new Error('The device did not accept these cells'));
  await act(async () => { await view.result.current.generate(point); });
  await act(async () => { expect(view.result.current.accept('p')).toBe(true); });
  expect(view.applyProposal).toHaveBeenCalledWith(generated.contentByNodeId, { p: 'Existing point', sub: 'Existing child' }, expect.any(Function));
  expect(view.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
  expect(view.restoreCells).not.toHaveBeenCalled();
});

it('keeps the proposal when the editing session already accepted a different opening', async () => {
  const view = setup({ p: 'Existing point', sub: 'Existing child' });
  const applyProposal = jest.fn().mockReturnValue(null);
  Object.assign(view.options.conspectus, { applyProposal });
  await act(async () => { await view.result.current.generate(point); });
  await act(async () => { expect(view.result.current.accept('p')).toBe(false); });
  expect(applyProposal).toHaveBeenCalledWith(generated.contentByNodeId, { p: 'Existing point', sub: 'Existing child' }, expect.any(Function));
  expect(view.result.current.proposals.p.contentByNodeId).toEqual(generated.contentByNodeId);
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.saveCells).not.toHaveBeenCalled();
});

it('keeps the proposal when the editing session requires a version decision before saving it', async () => {
  const view = setup({ p: 'Existing point', sub: 'Existing child' });
  const applyProposal = jest.fn().mockResolvedValue(false);
  Object.assign(view.options.conspectus, { applyProposal });
  await act(async () => { await view.result.current.generate(point); });

  await act(async () => { expect(view.result.current.accept('p')).toBe(true); });

  expect(applyProposal).toHaveBeenCalledWith(generated.contentByNodeId, { p: 'Existing point', sub: 'Existing child' }, expect.any(Function));
  expect(view.result.current.proposals.p?.contentByNodeId).toEqual(generated.contentByNodeId);
  expect(view.restoreCells).not.toHaveBeenCalled();
});

it('rechecks edits made after the proposal arrived before applying it', async () => {
  const view = setup({ p: 'Mine' });
  await act(async () => { await view.result.current.generate(point); });
  view.cells.sub = 'New manual text';
  await act(async () => { view.result.current.accept('p'); });
  expect(view.restoreCells).not.toHaveBeenCalled();
  expect(view.result.current.errors.p).toBe('contextChanged');
});

it('keeps existing text when the source lacks evidence and permits discarding the proposal', async () => {
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { p: '', sub: '- Detail' }, missingMaterial: { p: 'No evidence' } });
  const view = setup({ p: 'Keep me' });
  await act(async () => { await view.result.current.generate(point); });
  await act(async () => { view.result.current.accept('p'); });
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
  const view = setup({ p: 'Mine', q: 'Mine too' });
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

it('keeps both sent requests addressable when their editor unmounts', () => {
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise(() => undefined));
  const view = setup();
  act(() => { void view.result.current.generate(point); });
  act(() => { void view.result.current.generate(sermon.outline!.main[1]); });
  const sends = [...jest.mocked(generateNotePlanContent).mock.calls];
  expect(sends).toHaveLength(2);
  view.unmount();
  const reopened = setup();
  expect(reopened.result.current.pending.map(draft => draft.id).sort()).toEqual(sends.map(([, , operation]) => operation!.operationId).sort());
  // Both are checked on reopening — without starting a new paid request — and show as running.
  const checks = jest.mocked(generateNotePlanContent).mock.calls.slice(2);
  expect(checks.map(([, , operation]) => operation!.operationId).sort()).toEqual(sends.map(([, , operation]) => operation!.operationId).sort());
  expect(checks.every(([, , operation]) => operation!.recoverOnly)).toBe(true);
  expect(reopened.result.current.busy).toBe(true);
});

it('runs different points together and keeps their results isolated when they finish out of order', async () => {
  const resolve: Record<string, (value: NotePlanResult) => void> = {};
  jest.mocked(generateNotePlanContent).mockImplementation(({ outlinePointId }) => new Promise((done) => { resolve[outlinePointId] = done; }));
  const view = setup({ p: 'Mine', q: 'Mine too' });
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
  await act(async () => { view.result.current.accept('q'); view.result.current.accept('p'); });
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
  await act(async () => { expect(view.result.current.accept('gone')).toBe(false); });
  expect(view.restoreCells).not.toHaveBeenCalled();
});

it('regenerates only the selected child and preserves concurrent writing in its parent', async () => {
  const view = setup({ p: 'Parent draft', sub: 'Child draft' });
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- New child' }, missingMaterial: {} });
  await act(async () => { await view.result.current.generate(point, 'sub'); });
  expect(generateNotePlanContent).toHaveBeenCalledWith(expect.objectContaining({ outlinePointId: 'p', targetNodeId: 'sub' }), undefined, expect.objectContaining({ operationId: expect.any(String) }));
  expect(view.cells).toEqual({ p: 'Parent draft', sub: 'Child draft' });
  view.cells.p = 'Parent edited during review';
  await act(async () => { expect(view.result.current.accept('sub')).toBe(true); });
  expect(view.restoreCells).toHaveBeenCalledWith({ sub: '- New child' });
  expect(view.cells).toEqual({ p: 'Parent edited during review', sub: '- New child' });
});

it('does not overwrite a child edited after its targeted proposal arrived', async () => {
  const view = setup({ sub: 'Original' });
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- New' }, missingMaterial: {} });
  await act(async () => { await view.result.current.generate(point, 'sub'); });
  view.cells.sub = 'Manual correction';
  await act(async () => { expect(view.result.current.accept('sub')).toBe(false); });
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
  await act(async () => { view.result.current.accept('sibling'); });
  await act(async () => { resolve.sub({ contentByNodeId: { sub: '- First' }, missingMaterial: {} }); await first; });
  await act(async () => { view.result.current.accept('sub'); });
  expect(view.cells).toEqual({ p: 'Parent', sub: '- First', sibling: '- Second' });
});

it('blocks a child request while its whole point is generating', () => {
  const view = setup();
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise(() => undefined));
  act(() => { void view.result.current.generate(point); void view.result.current.generate(point, 'sub'); });
  expect(generateNotePlanContent).toHaveBeenCalledTimes(1);
});

it('retains earlier paid proposals when a later generation overlaps their cells', async () => {
  const view = setup({ p: 'Mine', sub: 'My detail' });
  await act(async () => { await view.result.current.generate(point); });
  const older = view.result.current.proposals.p;
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- Child only' }, missingMaterial: {} });
  await act(async () => { await view.result.current.generate(point, 'sub'); });
  expect(view.result.current.proposals.p.id).toBe(older.id);
  expect(view.result.current.proposals.sub).toBeDefined();

  await act(async () => { expect(view.result.current.accept('sub')).toBe(true); });
  expect(view.result.current.proposalChanged(view.result.current.proposals.p)).toBe(true);
  expect(view.result.current.proposals.p.id).toBe(older.id);
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

it('puts a refined answer in place of the version it was asked to improve — not under it', async () => {
  const view = setup({ p: 'Mine', sub: 'My detail' });
  await act(async () => { await view.result.current.generate(point); });
  const first = view.result.current.proposals.p;
  jest.mocked(generateNotePlanContent).mockResolvedValueOnce({ contentByNodeId: { p: '- Shorter', sub: '- Shorter detail' }, missingMaterial: {} });
  await act(async () => { await view.result.current.generate(point, undefined, { instruction: 'Shorter', mode: 'edit' as const }); });
  expect(view.result.current.ready).toHaveLength(1);
  expect(view.result.current.proposals.p.id).not.toBe(first.id);
  expect(view.result.current.proposals.p.contentByNodeId.p).toBe('- Shorter');
});

it('keeps the version on screen when the refined answer is blank or written from a changed note', async () => {
  const view = setup({ p: 'Mine', sub: 'My detail' });
  await act(async () => { await view.result.current.generate(point); });
  const first = view.result.current.proposals.p;
  jest.mocked(generateNotePlanContent).mockResolvedValueOnce({ contentByNodeId: { p: '', sub: '' }, missingMaterial: { p: 'Nothing new' } })
    .mockResolvedValueOnce({ ...generated, sourceChanged: true });
  await act(async () => { await view.result.current.generate(point, undefined, { instruction: 'Shorter', mode: 'edit' as const }); });
  await act(async () => { await view.result.current.generate(point, undefined, { instruction: 'Shorter', mode: 'edit' as const }); });
  expect(view.result.current.ready.map(proposal => proposal.id)).toContain(first.id);
});

it('leaves a waiting version a choice when the point is generated again plainly — only Refine replaces', async () => {
  const view = setup({ p: 'Mine', sub: 'My detail' });
  await act(async () => { await view.result.current.generate(point); });
  const first = view.result.current.proposals.p;
  await act(async () => { await view.result.current.generate(point); });
  expect(view.result.current.ready.map(proposal => proposal.id)).toContain(first.id);
  expect(view.result.current.ready).toHaveLength(2);
});

it('keeps the version on screen when the refinement fails', async () => {
  const view = setup({ p: 'Mine', sub: 'My detail' });
  await act(async () => { await view.result.current.generate(point); });
  const first = view.result.current.proposals.p;
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(new Error('network'));
  await act(async () => { await view.result.current.generate(point, undefined, { instruction: 'Shorter', mode: 'edit' as const }); });
  expect(view.result.current.errors.p).toBe('generationFailed');
  expect(view.result.current.ready.map(proposal => proposal.id)).toEqual([first.id]);
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
  expect(generateNotePlanContent).toHaveBeenLastCalledWith(expect.objectContaining({ revision: { ...intent, currentContentByNodeId: { sub: 'Unsaved child' } } }), undefined, expect.objectContaining({ operationId: expect.any(String) }));
  expect(view.result.current.refiningIds.sub).toBe(false);
  expect(view.cells.sub).toBe('Unsaved child');
  await act(async () => { view.result.current.accept('sub'); });
  expect(view.cells).toEqual({ p: 'Parent', sub: '- Refined' });
});
