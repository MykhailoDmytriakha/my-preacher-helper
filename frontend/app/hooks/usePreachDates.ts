import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PreachDate } from '@/models/models';
import { newClientId } from '@/utils/clientId';
import { PREACH_DATE_MUTATION_KEYS } from '@/utils/mutationDefaults';
import * as preachDatesService from '@services/preachDates.service';

export function usePreachDates(sermonId: string) {
    const queryClient = useQueryClient();
    const listKey = ['preachDates', sermonId] as const;

    const { data: preachDates = [], isLoading, error } = useServerFirstQuery({
        queryKey: listKey,
        queryFn: () => preachDatesService.fetchPreachDates(sermonId),
        enabled: !!sermonId,
    });

    // mutationKey + self-contained variables (sermonId carried in the payload) tie
    // each write to its resumable default in mutationDefaults.ts so a preach-date
    // edit made offline survives a reload and replays on reconnect.
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: listKey });
        queryClient.invalidateQueries({ queryKey: ['sermons'] });
    };

    // Optimistic onMutate on the ['preachDates', sermonId] cache (what PreachDateList
    // renders): without it an added/edited/deleted date only showed after the write +
    // refetch (~1s online; not until reconnect offline). We roll back on error; the
    // ['sermons'] cache still reconciles via the onSuccess invalidate.
    const snapshot = async () => {
        await queryClient.cancelQueries({ queryKey: listKey });
        return { previous: queryClient.getQueryData<PreachDate[]>(listKey) };
    };
    const rollback = (context: { previous?: PreachDate[] } | undefined) => {
        if (context?.previous) queryClient.setQueryData(listKey, context.previous);
    };

    const addMutation = useMutation({
        mutationKey: PREACH_DATE_MUTATION_KEYS.add,
        mutationFn: ({ sermonId: sid, data }: { sermonId: string; data: Omit<PreachDate, 'id' | 'createdAt'> }) =>
            preachDatesService.addPreachDate(sid, data),
        onMutate: async ({ data }: { sermonId: string; data: Omit<PreachDate, 'id' | 'createdAt'> }) => {
            const context = await snapshot();
            const optimistic: PreachDate = { ...data, id: newClientId(), createdAt: new Date().toISOString() };
            queryClient.setQueryData<PreachDate[]>(listKey, (old = []) => [...(old ?? []), optimistic]);
            return context;
        },
        onError: (_err, _vars, context) => rollback(context),
        onSuccess: invalidate,
    });

    const updateMutation = useMutation({
        mutationKey: PREACH_DATE_MUTATION_KEYS.update,
        mutationFn: ({ sermonId: sid, dateId, updates }: { sermonId: string; dateId: string; updates: Partial<PreachDate> }) =>
            preachDatesService.updatePreachDate(sid, dateId, updates),
        onMutate: async ({ dateId, updates }: { sermonId: string; dateId: string; updates: Partial<PreachDate> }) => {
            const context = await snapshot();
            queryClient.setQueryData<PreachDate[]>(listKey, (old = []) =>
                (old ?? []).map((pd) => (pd.id === dateId ? { ...pd, ...updates } : pd))
            );
            return context;
        },
        onError: (_err, _vars, context) => rollback(context),
        onSuccess: invalidate,
    });

    const deleteMutation = useMutation({
        mutationKey: PREACH_DATE_MUTATION_KEYS.delete,
        mutationFn: ({ sermonId: sid, dateId }: { sermonId: string; dateId: string }) =>
            preachDatesService.deletePreachDate(sid, dateId),
        onMutate: async ({ dateId }: { sermonId: string; dateId: string }) => {
            const context = await snapshot();
            queryClient.setQueryData<PreachDate[]>(listKey, (old = []) => (old ?? []).filter((pd) => pd.id !== dateId));
            return context;
        },
        onError: (_err, _vars, context) => rollback(context),
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
