import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PreachDate } from '@/models/models';
import { PREACH_DATE_MUTATION_KEYS } from '@/utils/mutationDefaults';
import * as preachDatesService from '@services/preachDates.service';

export function usePreachDates(sermonId: string) {
    const queryClient = useQueryClient();

    const { data: preachDates = [], isLoading, error } = useServerFirstQuery({
        queryKey: ['preachDates', sermonId],
        queryFn: () => preachDatesService.fetchPreachDates(sermonId),
        enabled: !!sermonId,
    });

    // mutationKey + self-contained variables (sermonId carried in the payload) tie
    // each write to its resumable default in mutationDefaults.ts so a preach-date
    // edit made offline survives a reload and replays on reconnect.
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['preachDates', sermonId] });
        queryClient.invalidateQueries({ queryKey: ['sermons'] });
    };

    const addMutation = useMutation({
        mutationKey: PREACH_DATE_MUTATION_KEYS.add,
        mutationFn: ({ sermonId: sid, data }: { sermonId: string; data: Omit<PreachDate, 'id' | 'createdAt'> }) =>
            preachDatesService.addPreachDate(sid, data),
        onSuccess: invalidate,
    });

    const updateMutation = useMutation({
        mutationKey: PREACH_DATE_MUTATION_KEYS.update,
        mutationFn: ({ sermonId: sid, dateId, updates }: { sermonId: string; dateId: string; updates: Partial<PreachDate> }) =>
            preachDatesService.updatePreachDate(sid, dateId, updates),
        onSuccess: invalidate,
    });

    const deleteMutation = useMutation({
        mutationKey: PREACH_DATE_MUTATION_KEYS.delete,
        mutationFn: ({ sermonId: sid, dateId }: { sermonId: string; dateId: string }) =>
            preachDatesService.deletePreachDate(sid, dateId),
        onSuccess: invalidate,
    });

    return {
        preachDates,
        isLoading,
        error,
        addDate: (data: Omit<PreachDate, 'id' | 'createdAt'>) => addMutation.mutateAsync({ sermonId, data }),
        updateDate: ({ dateId, updates }: { dateId: string; updates: Partial<PreachDate> }) =>
            updateMutation.mutateAsync({ sermonId, dateId, updates }),
        deleteDate: (dateId: string) => deleteMutation.mutateAsync({ sermonId, dateId }),
        isAdding: addMutation.isPending,
        isUpdating: updateMutation.isPending,
        isDeleting: deleteMutation.isPending,
    };
}
