import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PreachDate } from '@/models/models';
import * as preachDatesService from '@services/preachDates.service';

export function usePreachDates(sermonId: string) {
    const queryClient = useQueryClient();

    const { data: preachDates = [], isLoading, error } = useQuery({
        queryKey: ['preachDates', sermonId],
        queryFn: () => preachDatesService.fetchPreachDates(sermonId),
        enabled: !!sermonId,
    });

    const addMutation = useMutation({
        mutationFn: (data: Omit<PreachDate, 'id' | 'createdAt'>) =>
            preachDatesService.addPreachDate(sermonId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['preachDates', sermonId] });
            queryClient.invalidateQueries({ queryKey: ['sermons'] }); // Also invalidate sermon list to show warnings/stats correctly
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ dateId, updates }: { dateId: string; updates: Partial<PreachDate> }) =>
            preachDatesService.updatePreachDate(sermonId, dateId, updates),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['preachDates', sermonId] });
            queryClient.invalidateQueries({ queryKey: ['sermons'] });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (dateId: string) =>
            preachDatesService.deletePreachDate(sermonId, dateId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['preachDates', sermonId] });
            queryClient.invalidateQueries({ queryKey: ['sermons'] });
        },
    });

    return {
        preachDates,
        isLoading,
        error,
        addDate: addMutation.mutateAsync,
        updateDate: updateMutation.mutateAsync,
        deleteDate: deleteMutation.mutateAsync,
        isAdding: addMutation.isPending,
        isUpdating: updateMutation.isPending,
        isDeleting: deleteMutation.isPending,
    };
}
