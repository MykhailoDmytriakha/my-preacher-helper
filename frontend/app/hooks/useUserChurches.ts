import { useSermonsDataCollection } from '@/hooks/useSermonsDataCollection';
import { Church } from '@/models/models';
import { isUnspecifiedChurch } from '@/utils/church';

import { useAuth } from './useAuth';

export function useUserChurches() {
    const { user } = useAuth();
    const userId = user?.uid;

    /**
     * The sermons come from where the sermons live (BUG-20260930-legacy-cache-week-expiry): the
     * engine's own collection is on this device, so the suggestions survive having no network.
     */
    const engine = useSermonsDataCollection();
    const sermons = engine.sermons.filter(sermon => sermon.userId === userId);
    const isLoading = engine.loading;
    const error = engine.error;

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
