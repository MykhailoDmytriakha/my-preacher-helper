import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Church } from '@/models/models';
import { isUnspecifiedChurch } from '@/utils/church';
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

    /**
     * History comes from BOTH places a church can be named, because they are different
     * facts: `sermon.church` is the congregation a sermon is being prepared for (known
     * before any date exists), `preachDates[].church` is where it was actually preached.
     * Reading only the second one lost every church entered on a sermon that has no date
     * yet — exactly the case this list exists to make easier the next time.
     */
    const availableChurches = Array.from(
        sermons.reduce((acc, sermon) => {
            const remember = (church?: Church) => {
                // The "not specified" stand-in is stored on every dateless-church preach
                // date; offering it back as a suggestion would be offering nothing.
                if (isUnspecifiedChurch(church)) return;
                if (!church) return;
                const key = `${church.name}-${church.city || ''}`.toLowerCase();
                if (!acc.has(key)) {
                    acc.set(key, church);
                }
            };
            remember(sermon.church);
            sermon.preachDates?.forEach(pd => remember(pd.church));
            return acc;
        }, new Map<string, Church>()).values()
    );

    return {
        availableChurches,
        isLoading,
        error
    };
}
