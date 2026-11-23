import { act, renderHook } from '@testing-library/react';

import usePlanTextDraft from '@/(pages)/(private)/sermons/[id]/plan/usePlanTextDraft';
import { draftKey, listDraftKeys, readDraft, retireDraftCapture, saveDraft } from '@/utils/durableDraft';
import { PLAN_DRAFT_CAPTURE_PREFIX } from '@/utils/planDraftCapture.client';

jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

const owner = 'user-1';
const sermonId = 'sermon-1';
const cellKey = (id: string, writer?: string) => draftKey(owner, sermonId, `plan:${id}`, writer);
const defaults = { uid: owner, sermonId, liveNodeIds: new Set(['first', 'second']), frozen: false };
const render = (options: Partial<typeof defaults> = {}) => renderHook(props => usePlanTextDraft(props), {
  initialProps: { ...defaults, ...options },
});

beforeEach(() => { localStorage.clear(); });

it('offers old live cells and shows removed cells separately', () => {
  saveDraft(cellKey('first'), 'From last night.');
  saveDraft(cellKey('removed'), 'From a card that no longer exists.');
  saveDraft(draftKey('user-2', sermonId, 'plan:first'), 'Another account.');
  saveDraft(draftKey(owner, 'sermon-2', 'plan:first'), 'Another sermon.');
  saveDraft(draftKey(owner, sermonId, 'other:first'), 'Another feature.');

  const view = render();
  expect(view.result.current.recovered).toEqual({ first: 'From last night.' });
  expect(view.result.current.orphaned).toEqual([
    { id: 'removed', copyKey: cellKey('removed'), text: 'From a card that no longer exists.' },
  ]);
});

it('does not promote older or queued words to another copy when the screen leaves', () => {
  const source = cellKey('first');
  saveDraft(source, 'The existing copy.');
  const view = render();
  act(() => { window.dispatchEvent(new Event('pagehide')); });
  view.unmount();
  expect(listDraftKeys()).toEqual([source]);
});

it('deletes only the explicitly selected copy even when two copies contain the same words', () => {
  const original = cellKey('first');
  const other = cellKey('first', 'other-opening');
  saveDraft(original, 'Same words.');
  saveDraft(other, 'Same words.');
  const view = render();
  act(() => { view.result.current.selectCopy('first', other); });
  expect(view.result.current.selectedCopies).toMatchObject([{ key: other }]);
  act(() => { view.result.current.discard(); });
  expect(readDraft(other)).toBeNull();
  expect(readDraft(original)?.value).toBe('Same words.');
  expect(view.result.current.recovered).toEqual({ first: 'Same words.' });
});

it.each([false, true])('retires the selected source after handoff and preserves another one (token=%s)', token => {
  const source = cellKey('first');
  const other = cellKey('first', 'other-opening');
  saveDraft(source, 'Source for the document session.', undefined, token);
  const view = render();
  const selected = view.result.current.selectedCopies;
  saveDraft(other, 'Source for the document session.', undefined, token);
  act(() => { view.result.current.accept(selected); });
  expect(readDraft(source)).toBeNull();
  expect(readDraft(other)?.value).toBe('Source for the document session.');
});

it.each(['later text', 'same words'] as const)('preserves a source replaced while its earlier version was being staged (%s)', change => {
  const source = cellKey('first');
  saveDraft(source, 'Original source.', undefined, true);
  const view = render();
  const selected = view.result.current.selectedCopies;
  const later = change === 'same words' ? 'Original source.' : 'Edited source.';
  saveDraft(source, later, undefined, 'renew');
  act(() => { view.result.current.accept(selected); });
  expect(readDraft(source)?.value).toBe(later);
  act(() => { view.result.current.refreshLegacy(); });
  expect(view.result.current.recovered).toEqual({ first: later });
});

it('forgets only a shown stored orphan and leaves unsupported or foreign addresses alone', () => {
  const first = cellKey('gone');
  const second = cellKey('gone', 'other-opening');
  saveDraft(first, 'First orphan.');
  saveDraft(second, 'Second orphan.');
  const view = render();
  act(() => { view.result.current.forget([{ id: 'gone', text: 'First orphan.' }]); });
  expect(readDraft(first)?.value).toBe('First orphan.');
  act(() => { view.result.current.forget([view.result.current.orphaned[0]]); });
  expect(readDraft(first)).toBeNull();
  expect(readDraft(second)?.value).toBe('Second orphan.');
  expect(view.result.current.orphaned.map(copy => copy.text)).toEqual(['Second orphan.']);
});

it('removes the offer after the engine retires the exact address', () => {
  const key = cellKey('first');
  saveDraft(key, 'Already carried by a transfer.', undefined, true);
  const proof = readDraft(key)!.captureToken!;
  const view = render();
  act(() => { expect(retireDraftCapture(key, proof, 'Already carried by a transfer.')).toBe(true); });
  expect(view.result.current.recovered).toBeNull();
});

it('preserves the source in the frozen copy and ignores a callback from the previous account', () => {
  const first = cellKey('first');
  const second = draftKey('user-2', sermonId, 'plan:first');
  saveDraft(first, 'First owner.');
  saveDraft(second, 'Second owner.');
  const view = render();
  const discardBeforeFreeze = view.result.current.discard;
  view.rerender({ ...defaults, frozen: true });
  act(discardBeforeFreeze);
  expect(readDraft(first)?.value).toBe('First owner.');
  view.rerender({ ...defaults, uid: 'user-2' });
  act(discardBeforeFreeze);
  expect(readDraft(first)?.value).toBe('First owner.');
  expect(readDraft(second)?.value).toBe('Second owner.');
});

it('asks the active document to bind only the transferred words', () => {
  const key = cellKey('second', 'engine-opening');
  const bindPlanCellBackups = jest.fn(() => [{ key, proof: 'device-receipt' }]);
  const view = renderHook(() => usePlanTextDraft({ ...defaults, backupAuthority: { bindPlanCellBackups } }));
  const scope = view.result.current.prepareTransferCapture('first', 'second', 'Parent text.', 'Child text.');
  expect(bindPlanCellBackups).toHaveBeenCalledWith({ first: 'Parent text.', second: 'Child text.' });
  expect(JSON.parse(decodeURIComponent(scope!.slice(PLAN_DRAFT_CAPTURE_PREFIX.length)))).toEqual({
    pointId: 'first', subPointId: 'second', copies: [{ key, proof: 'device-receipt' }],
  });
  expect(listDraftKeys()).toEqual([]);
});
