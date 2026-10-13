import { renderHook } from '@testing-library/react';

import { useDataCollection } from '@/data-engine/react.client';
import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';
import { useCalendarGroups } from '@/hooks/useCalendarGroups';

jest.mock('@/data-engine/react.client', () => ({ useDataCollection: jest.fn() }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useDataCollection).mockReturnValue({ loading: false, readOnly: false, error: null, refresh: jest.fn(), state: {
    complete: true, freshness: 'server', checking: false, error: null, version: 5, snapshots: [
      { resource: { collection: 'groups', id: 'a' }, metadata: null, value: { userId: 'owner', title: 'Updated', updatedAt: '2', meetingDates: [{ id: 'm', date: '2026-09-19', createdAt: '1' }] } },
      { resource: { collection: 'groups', id: 'gone' }, value: null, metadata: { protocol: 1, generation: 'g', revision: 2, deleted: true } },
    ],
  } });
});
it('projects current rows and hides tombstones using the same legacy shape', () => {
  const { result } = renderHook(() => useGroupsDataCollection());
  expect(result.current.groups).toEqual([expect.objectContaining({ id: 'a', title: 'Updated', status: 'draft', flow: [], templates: [] })]);
  expect(result.current.complete).toBe(true);
});
it('uses the shared submitted projection while keeping completeness and status available', () => {
  const source = jest.mocked(useDataCollection).getMockImplementation()!('groups');
  jest.mocked(useDataCollection).mockReturnValue({ ...source, state: { ...source.state!, complete: false, documents: [{
    resource: { collection: 'groups', id: 'pending' }, value: { userId: 'owner', title: 'Queued' }, pending: true, needsAttention: false, deleting: false,
  }] } });
  const { result } = renderHook(() => useGroupsDataCollection());
  expect(result.current.groups).toEqual([expect.objectContaining({ id: 'pending', title: 'Queued' })]);
  expect(result.current.complete).toBe(false);
  expect(result.current.state?.documents?.[0].pending).toBe(true);
});
it('keeps the engine read idle when the reader is inactive', () => {
  renderHook(() => useGroupsDataCollection(false)); expect(useDataCollection).toHaveBeenLastCalledWith(null);
  renderHook(() => useGroupsDataCollection()); expect(useDataCollection).toHaveBeenLastCalledWith('groups');
});
it('uses the same engine rows for the calendar', () => {
  const { result, rerender } = renderHook(({ start }) => useCalendarGroups(new Date(start), new Date('2026-09-20T00:00:00Z')), { initialProps: { start: '2026-09-19T00:00:00Z' } });
  expect(result.current.groups.map(group => group.id)).toEqual(['a']);
  rerender({ start: '2026-09-20T00:00:00Z' }); expect(result.current.groups).toEqual([]);
});
