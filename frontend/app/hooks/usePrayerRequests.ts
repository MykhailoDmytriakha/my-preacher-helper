import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PrayerRequest, PrayerStatus } from '@/models/models';
import {
  addPrayerUpdate,
  createPrayerRequest,
  deletePrayerRequest,
  getAllPrayerRequests,
  setPrayerStatus,
  updatePrayerRequest,
} from '@services/prayerRequests.service';

export const PRAYER_QUERY_KEY = (userId: string | null) => ['prayerRequests', userId];

export function usePrayerRequests(userId?: string | null) {
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const isOnline = useOnlineStatus();
  const { uid: resolvedUid } = useResolvedUid();
  const effectiveUserId = userId ?? resolvedUid ?? null;

  const {
    data: prayerRequests = [],
    isLoading,
    error,
  } = useServerFirstQuery<PrayerRequest[]>({
    queryKey: PRAYER_QUERY_KEY(effectiveUserId),
    queryFn: () => (effectiveUserId ? getAllPrayerRequests(effectiveUserId) : Promise.resolve([])),
    enabled: !!effectiveUserId,
  });

  const mutationGuard = useCallback(
    async <TResult>(action: () => Promise<TResult>) => {
      if (!isOnline) {
        const err = new Error('Offline: operation not available.');
        setMutationError(err);
        throw err;
      }
      setMutationError(null);
      try {
        return await action();
      } catch (e: unknown) {
        const normalized = e instanceof Error ? e : new Error(String(e));
        setMutationError(normalized);
        throw normalized;
      }
    },
    [isOnline]
  );

  const createMutation = useMutation({
    mutationFn: (payload: Pick<PrayerRequest, 'userId' | 'title'> & Partial<Pick<PrayerRequest, 'description' | 'categoryId' | 'tags'>>) =>
      createPrayerRequest(payload),
    onSuccess: (created) => {
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) => [created, ...old]);
      queryClient.invalidateQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId), refetchType: 'none' });
      setMutationError(null);
    },
    onError: (e: unknown) => setMutationError(e instanceof Error ? e : new Error(String(e))),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<PrayerRequest> }) =>
      updatePrayerRequest(id, updates),
    onSuccess: (updated) => {
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) =>
        old.map((p) => (p.id === updated.id ? updated : p))
      );
      queryClient.setQueryData<PrayerRequest>(['prayerRequest', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId), refetchType: 'none' });
      setMutationError(null);
    },
    onError: (e: unknown) => setMutationError(e instanceof Error ? e : new Error(String(e))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePrayerRequest(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId) });
      const previous = queryClient.getQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId));
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) =>
        old.filter((p) => p.id !== id)
      );
      return { previous };
    },
    onError: (e: unknown, _id, context) => {
      if (context?.previous) queryClient.setQueryData(PRAYER_QUERY_KEY(effectiveUserId), context.previous);
      setMutationError(e instanceof Error ? e : new Error(String(e)));
    },
    onSuccess: (_r, id) => {
      queryClient.removeQueries({ queryKey: ['prayerRequest', id] });
      setMutationError(null);
    },
  });

  const addUpdateMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => addPrayerUpdate(id, text),
    onSuccess: (updated) => {
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) =>
        old.map((p) => (p.id === updated.id ? updated : p))
      );
      queryClient.setQueryData<PrayerRequest>(['prayerRequest', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId), refetchType: 'none' });
      setMutationError(null);
    },
    onError: (e: unknown) => setMutationError(e instanceof Error ? e : new Error(String(e))),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, answerText }: { id: string; status: PrayerStatus; answerText?: string }) => setPrayerStatus(id, status, answerText),
    onSuccess: (updated) => {
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) =>
        old.map((p) => (p.id === updated.id ? updated : p))
      );
      queryClient.setQueryData<PrayerRequest>(['prayerRequest', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId), refetchType: 'none' });
      setMutationError(null);
    },
    onError: (e: unknown) => setMutationError(e instanceof Error ? e : new Error(String(e))),
  });

  return {
    prayerRequests,
    loading: isLoading,
    error: (error as Error | null) ?? mutationError,
    createPrayer: (payload: Pick<PrayerRequest, 'userId' | 'title'> & Partial<Pick<PrayerRequest, 'description' | 'categoryId' | 'tags'>>) =>
      mutationGuard(() => createMutation.mutateAsync(payload)),
    updatePrayer: (id: string, updates: Partial<PrayerRequest>) =>
      mutationGuard(() => updateMutation.mutateAsync({ id, updates })),
    deletePrayer: (id: string) => mutationGuard(() => deleteMutation.mutateAsync(id)),
    addUpdate: (id: string, text: string) => mutationGuard(() => addUpdateMutation.mutateAsync({ id, text })),
    setStatus: (id: string, status: PrayerStatus, answerText?: string) => mutationGuard(() => statusMutation.mutateAsync({ id, status, answerText })),
  };
}
