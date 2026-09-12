import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import * as groupsService from '@services/groups.service';

import { useAuth } from './useAuth';

export function useCalendarGroups(startDate?: Date, endDate?: Date) {
  const { user } = useAuth();
  const userId = user?.uid;

  const startStr = startDate?.toISOString().split('T')[0];
  const endStr = endDate?.toISOString().split('T')[0];

  const { data: groups = [], isLoading, error, refetch } = useServerFirstQuery({
    queryKey: ['calendarGroups', userId, startStr, endStr],
    queryFn: () => {
      if (!userId) return Promise.resolve([]);
      return groupsService.fetchCalendarGroups(userId, startStr, endStr);
    },
    enabled: !!userId,
  });

  return {
    groups,
    isLoading,
    error,
    refetch,
  };
}
