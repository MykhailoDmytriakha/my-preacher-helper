import { isCollectionOnEngine } from '@/data-engine/react.client';
import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import * as groupsService from '@services/groups.service';

import { useAuth } from './useAuth';

export function useCalendarGroups(startDate?: Date, endDate?: Date) {
  const { user } = useAuth();
  const userId = user?.uid;

  const startStr = startDate?.toISOString().split('T')[0];
  const endStr = endDate?.toISOString().split('T')[0];

  const engine = useGroupsDataCollection();
  const { data: groups = [], isLoading, error, refetch } = useServerFirstQuery({
    queryKey: ['calendarGroups', userId, startStr, endStr],
    queryFn: () => {
      if (!userId) return Promise.resolve([]);
      return groupsService.fetchCalendarGroups(userId, startStr, endStr);
    },
    enabled: !!userId && !isCollectionOnEngine('groups'),
  });

  if (isCollectionOnEngine('groups')) return {
    groups: engine.groups.filter(group => group.userId === userId && (group.meetingDates ?? []).some(meeting =>
      (!startStr || meeting.date >= startStr) && (!endStr || meeting.date <= endStr))),
    isLoading: engine.loading, error: engine.error, refetch: engine.refreshGroups,
  };

  return {
    groups,
    isLoading,
    error,
    refetch,
  };
}
