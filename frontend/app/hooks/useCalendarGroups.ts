import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';
import { groupMeetingDay } from '@/utils/groupMeeting';

import { useAuth } from './useAuth';

/** The caller's groups with a meeting inside the range, from the data engine (groups are engine-owned). */
export function useCalendarGroups(startDate?: Date, endDate?: Date) {
  const { user } = useAuth();
  const userId = user?.uid;

  const startStr = startDate?.toISOString().split('T')[0];
  const endStr = endDate?.toISOString().split('T')[0];

  const engine = useGroupsDataCollection();
  return {
    groups: engine.groups.filter(group => group.userId === userId && (group.meetingDates ?? []).some(meeting => {
      const day = groupMeetingDay(meeting.date);
      return Boolean(day && (!startStr || day >= startStr) && (!endStr || day <= endStr));
    })),
    isLoading: engine.loading, error: engine.error, refetch: engine.refreshGroups,
  };
}
