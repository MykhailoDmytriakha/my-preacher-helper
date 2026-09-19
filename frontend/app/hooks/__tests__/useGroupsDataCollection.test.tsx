import { renderHook } from '@testing-library/react';

import { isCollectionOnEngine, useDataCollection } from '@/data-engine/react.client';
import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';
import { useCalendarGroups } from '@/hooks/useCalendarGroups';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';

jest.mock('@/data-engine/react.client', () => ({ isCollectionOnEngine: jest.fn(), useDataCollection: jest.fn() }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useServerFirstQuery', () => ({ useServerFirstQuery: jest.fn(() => ({ data: [], isLoading: false })) }));
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(isCollectionOnEngine).mockReturnValue(true);
  jest.mocked(useDataCollection).mockReturnValue({ loading: false, error: null, refresh: jest.fn(), state: {
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
it('keeps the engine read idle when the domain or reader is inactive', () => {
  jest.mocked(isCollectionOnEngine).mockReturnValue(false);
  renderHook(() => useGroupsDataCollection()); expect(useDataCollection).toHaveBeenLastCalledWith(null);
  jest.mocked(isCollectionOnEngine).mockReturnValue(true);
  renderHook(() => useGroupsDataCollection(false)); expect(useDataCollection).toHaveBeenLastCalledWith(null);
});
it('uses the same engine rows for the calendar and disables its old query', () => {
  const { result, rerender } = renderHook(({ start }) => useCalendarGroups(new Date(start), new Date('2026-09-20T00:00:00Z')), { initialProps: { start: '2026-09-19T00:00:00Z' } });
  expect(result.current.groups.map(group => group.id)).toEqual(['a']);
  expect(useServerFirstQuery).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  rerender({ start: '2026-09-20T00:00:00Z' }); expect(result.current.groups).toEqual([]);
});
