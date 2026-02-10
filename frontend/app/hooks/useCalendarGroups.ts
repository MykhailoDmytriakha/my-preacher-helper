import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Group, GroupMeetingDate } from '@/models/models';
import * as groupsService from '@services/groups.service';

import { useAuth } from './useAuth';

type GroupWithMeetingContext = Group & { currentMeetingDate: GroupMeetingDate };

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

  const groupsByDate = groups.reduce((acc, group) => {
    (group.meetingDates || []).forEach((meetingDate) => {
      if (!acc[meetingDate.date]) {
        acc[meetingDate.date] = [];
      }

      acc[meetingDate.date].push({
        ...group,
        currentMeetingDate: meetingDate,
      });
    });

    return acc;
  }, {} as Record<string, GroupWithMeetingContext[]>);

  return {
    groups,
    groupsByDate,
    isLoading,
    error,
    refetch,
  };
}
