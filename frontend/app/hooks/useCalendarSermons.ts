import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PreachDate, Sermon } from '@/models/models';
import * as preachDatesService from '@services/preachDates.service';

import { useAuth } from './useAuth';

export function useCalendarSermons(startDate?: Date, endDate?: Date) {
    const { user } = useAuth();
    const userId = user?.uid;

    const startStr = startDate?.toISOString().split('T')[0];
    const endStr = endDate?.toISOString().split('T')[0];

    const { data: sermons = [], isLoading, error, refetch } = useServerFirstQuery({
        queryKey: ['calendarSermons', userId, startStr, endStr],
        queryFn: () => {
            if (!userId) return Promise.resolve([]);
            return preachDatesService.fetchCalendarSermons(userId, startStr, endStr);
        },
        enabled: !!userId,
    });

    // Identify "pending" sermons (legacy preached sermons without specific preachDates)
    const pendingSermons = sermons.filter(s => s.isPreached && (!s.preachDates || s.preachDates.length === 0));

    // Group sermons by date for easier rendering in the calendar
    const sermonsByDate = sermons.reduce((acc, sermon) => {
        sermon.preachDates?.forEach(pd => {
            if (!acc[pd.date]) {
                acc[pd.date] = [];
            }
            acc[pd.date].push({
                ...sermon,
                currentPreachDate: pd // Attach the specific preach date context
            });
        });
        return acc;
    }, {} as Record<string, (Sermon & { currentPreachDate: PreachDate })[]>);

    return {
        sermons,
        sermonsByDate,
        pendingSermons,
        isLoading,
        error,
        refetch,
    };
}
