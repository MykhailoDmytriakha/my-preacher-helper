import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { getSermons } from '@services/sermon.service';
import { Church } from '@/models/models';

export function useUserChurches() {
    const { user } = useAuth();
    const userId = user?.uid;

    const { data: sermons = [], isLoading, error } = useQuery({
        queryKey: ['sermons', userId, 'all'], // Slightly different key to fetch all for churches
        queryFn: () => {
            if (!userId) return Promise.resolve([]);
            return getSermons(userId);
        },
        enabled: !!userId,
        staleTime: 5 * 60 * 1000, // 5 minutes cache
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
