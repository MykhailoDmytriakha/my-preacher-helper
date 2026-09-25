import { act, renderHook } from '@testing-library/react';
import { useDataDocument } from '@/data-engine/react.client';
import { useGroupDataDocument } from '@/hooks/useGroupDataDocument';
import type { DocumentData } from '@/data-engine/types';
jest.mock('@/data-engine/react.client', () => ({ ...jest.requireActual('@/data-engine/react.client'), useDataDocument: jest.fn() }));
const stored = (): DocumentData => ({ userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [], createdAt: 'created', updatedAt: 'old', meetingDates: [{ id: 'one', date: '2026-09-19', createdAt: 'created', notes: 'Keep' }] });
function setup(initial: DocumentData | null = stored()) {
  let current = initial;
  const update = jest.fn(async (updater: (value: DocumentData | null) => DocumentData | null) => { current = updater(current); });
  const remove = jest.fn().mockResolvedValue(undefined), save = jest.fn();
  jest.mocked(useDataDocument).mockReturnValue({ data: initial, confirmed: null, remote: null, status: null, loading: false, error: null, update, remove, save } as unknown as ReturnType<typeof useDataDocument>);
  return { ...renderHook(() => useGroupDataDocument('group-1')), update, remove, save, read: () => current, replace: (value: DocumentData) => { current = value; } };
}
beforeEach(() => jest.clearAllMocks());
it('edits the current engine draft immediately without a second delivery timer', async () => {
  const { result, read, replace, save, update } = setup();
  replace({ ...stored(), description: 'Newer draft field' });
  await act(async () => { await result.current.updateGroupDetail({ title: 'Typed' }); });
  expect(read()).toMatchObject({ title: 'Typed', description: 'Newer draft field', userId: 'owner' });
  expect(read()).not.toHaveProperty('id'); expect(update).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled();
  expect(useDataDocument).toHaveBeenCalledWith({ collection: 'groups', id: 'group-1' }, { slot: 'group' });
});
it('preserves meeting siblings and identity and can clear an optional field', async () => {
  const { result, read } = setup();
  await act(async () => {
    await result.current.addMeetingDate({ id: 'two', date: '2026-09-20', location: 'Hall' });
    await result.current.updateMeetingDate('one', { date: '2026-09-21', notes: undefined, id: 'fake', createdAt: 'fake' });
  });
  expect(read()?.meetingDates).toEqual([{ id: 'one', date: '2026-09-21', createdAt: 'created' }, expect.objectContaining({ id: 'two', date: '2026-09-20', location: 'Hall' })]);
  await act(async () => { await result.current.removeMeetingDate('one'); });
  expect(read()?.meetingDates).toEqual([expect.objectContaining({ id: 'two' })]);
});
it('refuses a missing meeting and duplicate identities without changing the draft', async () => {
  const { result, read } = setup();
  await expect(result.current.updateMeetingDate('missing', { date: '2026-09-21' })).rejects.toThrow('not found');
  await expect(result.current.addMeetingDate({ id: 'one', date: '2026-09-21' })).rejects.toThrow('already exists');
  expect(read()).toEqual(stored());
});
it.each([{ id: 'foreign' }, { userId: 'foreign' }, { createdAt: 'later' }, { seriesId: 'series' }])('refuses identity or membership mutation %p', async patch => {
  const { result, read } = setup();
  await expect(result.current.updateGroupDetail(patch)).rejects.toThrow('not editable'); expect(read()).toEqual(stored());
});
it('uses the engine tombstone operation instead of editing an empty document', async () => {
  const { result, update, remove } = setup();
  await act(async () => { await result.current.deleteGroupDetail(); });
  expect(remove).toHaveBeenCalledTimes(1); expect(update).not.toHaveBeenCalled();
});
it('refuses editing a deleted document rather than resurrecting it', async () => {
  const { result, read } = setup(null);
  expect(result.current.group).toBeNull();
  await expect(result.current.updateGroupDetail({ title: 'Return' })).rejects.toThrow('not available'); expect(read()).toBeNull();
});
