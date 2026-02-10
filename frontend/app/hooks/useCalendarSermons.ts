import { useEffect } from 'react';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PreachDate, Sermon } from '@/models/models';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { debugLog } from '@/utils/debugMode';
import { countPreachDatesByStatus, getEffectiveIsPreached } from '@/utils/preachDateStatus';
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

    // Identify "pending" sermons (legacy preached sermons without factual preached dates)
    const pendingSermons = sermons.filter(
        (sermon) => getEffectiveIsPreached(sermon) && countPreachDatesByStatus(sermon, 'preached') === 0
    );

    // Group sermons by date for easier rendering in the calendar
    const sermonsByDate = sermons.reduce((acc, sermon) => {
        sermon.preachDates?.forEach(pd => {
            const dateKey = toDateOnlyKey(pd.date);
            if (!dateKey) {
                return;
            }

            if (!acc[dateKey]) {
                acc[dateKey] = [];
            }
            acc[dateKey].push({
                ...sermon,
                currentPreachDate: {
                    ...pd,
                    date: dateKey
                } // Attach the specific preach date context
            });
        });
        return acc;
    }, {} as Record<string, (Sermon & { currentPreachDate: PreachDate })[]>);

    useEffect(() => {
        if (!sermons || sermons.length === 0) {
            return;
        }

        const sermonsSummary = sermons.map((sermon) => ({
            sermonId: sermon.id,
            title: sermon.title,
            preachDates: (sermon.preachDates || []).map((preachDate) => ({
                id: preachDate.id,
                rawDate: preachDate.date,
                normalizedDate: toDateOnlyKey(preachDate.date),
                status: preachDate.status,
            }))
        }));

        debugLog('[calendar][useCalendarSermons] payload summary', {
            sermonsCount: sermons.length,
            groupedKeys: Object.keys(sermonsByDate).sort(),
            sermonsSummary,
        });
    }, [sermons, sermonsByDate]);

    return {
        sermons,
        sermonsByDate,
        pendingSermons,
        isLoading,
        error,
        refetch,
    };
}
