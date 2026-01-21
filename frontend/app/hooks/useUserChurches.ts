import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Church } from '@/models/models';
import { getSermons } from '@services/sermon.service';

import { useAuth } from './useAuth';

export function useUserChurches() {
    const { user } = useAuth();
    const userId = user?.uid;

    const { data: sermons = [], isLoading, error } = useServerFirstQuery({
        queryKey: ['sermons', userId, 'all'], // Slightly different key to fetch all for churches
        queryFn: () => {
            if (!userId) return Promise.resolve([]);
            return getSermons(userId);
        },
        enabled: !!userId,
    });

    const availableChurches = Array.from(
        sermons.reduce((acc, sermon) => {
            sermon.preachDates?.forEach(pd => {
                const key = `${pd.church.name}-${pd.church.city || ''}`.toLowerCase();
                if (!acc.has(key)) {
                    acc.set(key, pd.church);
                }
            });
            return acc;
        }, new Map<string, Church>()).values()
    );

    return {
        availableChurches,
        isLoading,
        error
    };
}
