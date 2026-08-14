import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PreachDate } from '@/models/models';
import { newClientId } from '@/utils/clientId';
import { PREACH_DATE_MUTATION_KEYS } from '@/utils/mutationDefaults';
import {
    queuedMutation,
    useWriteRecovery,
    type WriteSubmission,
} from '@/utils/recoverableWrite';
import { recoveryText } from '@/utils/writeRecovery';
import * as preachDatesService from '@services/preachDates.service';

type AddPreachDateVariables = {
    sermonId: string;
    // WHOSE write this is. Not sent to the server — it lets a refusal that arrives
    // after this screen closed be reported to the right person, and to nobody else.
    userId?: string;
    data: Omit<PreachDate, 'id' | 'createdAt'> & { id: string };
};

type UpdatePreachDateVariables = {
    sermonId: string;
    userId?: string;
    dateId: string;
    updates: Partial<PreachDate>;
};

type DeletePreachDateVariables = {
    sermonId: string;
    userId?: string;
    dateId: string;
};

export function usePreachDates(sermonId: string) {
    const queryClient = useQueryClient();
    const listKey = ['preachDates', sermonId] as const;
    // Recorded INTO each write so a late refusal can be attributed to a person.
    const { uid: ownerUid } = useResolvedUid();

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
        mutationFn: ({ sermonId: sid, data }: AddPreachDateVariables) =>
            preachDatesService.addPreachDate(sid, data),
        onMutate: async ({ data }: AddPreachDateVariables) => {
            const context = await snapshot();
            const optimistic: PreachDate = { ...data, id: data.id, createdAt: new Date().toISOString() };
            queryClient.setQueryData<PreachDate[]>(listKey, (old = []) => [...(old ?? []), optimistic]);
            return context;
        },
        onError: (_err, _vars, context) => rollback(context),
        onSuccess: invalidate,
    });

    const updateMutation = useMutation({
        mutationKey: PREACH_DATE_MUTATION_KEYS.update,
        mutationFn: ({ sermonId: sid, dateId, updates }: UpdatePreachDateVariables) =>
            preachDatesService.updatePreachDate(sid, dateId, updates),
        onMutate: async ({ dateId, updates }: UpdatePreachDateVariables) => {
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
        mutationFn: ({ sermonId: sid, dateId }: DeletePreachDateVariables) =>
            preachDatesService.deletePreachDate(sid, dateId),
        onMutate: async ({ dateId }: DeletePreachDateVariables) => {
            const context = await snapshot();
            queryClient.setQueryData<PreachDate[]>(listKey, (old = []) => (old ?? []).filter((pd) => pd.id !== dateId));
            return context;
        },
        onError: (_err, _vars, context) => rollback(context),
        onSuccess: invalidate,
    });

    // The mutations are persisted by React Query and registered again after a
    // reload, so their durable owner is the mutation queue rather than this hook.
    // A terminal refusal is reported by the descriptors below, which live as long as
    // THIS screen does; a refusal that lands after the person navigates away is the
    // tracked debt BUG-20260813-late-refusal-silent-after-navigation. A queued write is
    // intentionally not an error.
    useWriteRecovery<AddPreachDateVariables>(queryClient, {
        mutationKey: PREACH_DATE_MUTATION_KEYS.add,
        fallbackTitleKey: 'writeRecovery.preachDateFailed',
        titleParams: ({ data }) => ({ name: data.church.name }),
        recoveryText: ({ data }) =>
            recoveryText([data.date, data.church.name, data.church.city, data.audience, data.notes]),
        toastId: ({ sermonId: sid, data }) => `write-recovery:preach-date:add:${sid}:${data.id}`,
        // FAIL CLOSED. The route is not proof of ownership: opening a previous
        // account's sermon URL makes `sermonId` match, and a refusal restored from the
        // shared cache would then be read aloud — church, audience, notes — to the
        // wrong person. A payload predating the owner field says nothing about whose it
        // is, so it is not reported at all: silence costs a notice, speaking costs
        // someone else's privacy.
        owns: (variables) =>
            variables.sermonId === sermonId &&
            Boolean(ownerUid) &&
            variables.userId === ownerUid,
        retry: (variables) => addMutation.mutate(variables),
    });

    useWriteRecovery<UpdatePreachDateVariables>(queryClient, {
        mutationKey: PREACH_DATE_MUTATION_KEYS.update,
        fallbackTitleKey: 'writeRecovery.preachDateFailed',
        titleParams: ({ updates }) => ({ name: updates.church?.name ?? '' }),
        recoveryText: ({ updates }) => recoveryText([
            updates.date,
            updates.church?.name,
            updates.church?.city,
            updates.audience,
            updates.notes,
        ]),
        toastId: ({ sermonId: sid, dateId }) => `write-recovery:preach-date:update:${sid}:${dateId}`,
        owns: (variables) =>
            variables.sermonId === sermonId &&
            Boolean(ownerUid) &&
            variables.userId === ownerUid,
        retry: (variables) => updateMutation.mutate(variables),
    });

    useWriteRecovery<DeletePreachDateVariables>(queryClient, {
        mutationKey: PREACH_DATE_MUTATION_KEYS.delete,
        fallbackTitleKey: 'writeRecovery.preachDateFailed',
        recoveryText: () => undefined,
        toastId: ({ sermonId: sid, dateId }) => `write-recovery:preach-date:delete:${sid}:${dateId}`,
        owns: (variables) =>
            variables.sermonId === sermonId &&
            Boolean(ownerUid) &&
            variables.userId === ownerUid,
        retry: (variables) => deleteMutation.mutate(variables),
    });

    return {
        preachDates,
        isLoading,
        error,
        addDate: (data: Omit<PreachDate, 'id' | 'createdAt'>): WriteSubmission => {
            const variables: AddPreachDateVariables = {
                sermonId,
                userId: ownerUid ?? undefined,
                // The id travels in persisted mutation variables. A replay therefore
                // targets the same resource instead of creating a duplicate date.
                data: { ...data, id: newClientId() },
            };
            return queuedMutation(
                `preach-date:add:${sermonId}:${variables.data.id}`,
                addMutation.mutateAsync(variables)
            );
        },
        updateDate: ({ dateId, updates }: { dateId: string; updates: Partial<PreachDate> }): WriteSubmission => {
            const variables: UpdatePreachDateVariables = {
                sermonId,
                userId: ownerUid ?? undefined,
                dateId,
                updates,
            };
            return queuedMutation(
                `preach-date:update:${sermonId}:${dateId}`,
                updateMutation.mutateAsync(variables)
            );
        },
        deleteDate: (dateId: string): WriteSubmission => {
            const variables: DeletePreachDateVariables = {
                sermonId,
                userId: ownerUid ?? undefined,
                dateId,
            };
            return queuedMutation(
                `preach-date:delete:${sermonId}:${dateId}`,
                deleteMutation.mutateAsync(variables)
            );
        },
        isAdding: addMutation.isPending,
        isUpdating: updateMutation.isPending,
        isDeleting: deleteMutation.isPending,
    };
}
