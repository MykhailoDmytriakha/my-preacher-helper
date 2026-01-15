import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { addCustomTag, getTags, removeCustomTag, updateTag } from '@/services/tag.service';

import type { Tag } from '@/models/models';

type TagPayload = {
  requiredTags: Tag[];
  customTags: Tag[];
};

const EMPTY_TAGS: TagPayload = { requiredTags: [], customTags: [] };

const buildQueryKey = (userId: string | null | undefined) => ['tags', userId ?? null];

export function useTags(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const tagsQuery = useQuery<TagPayload>({
    queryKey: buildQueryKey(userId),
    queryFn: () => (userId ? getTags(userId) : Promise.resolve(EMPTY_TAGS)),
    enabled: Boolean(userId) && isOnline,
    staleTime: 60_000,
  });

  const tags = tagsQuery.data ?? EMPTY_TAGS;

  const allTags = useMemo(
    () => [...(tags.requiredTags ?? []), ...(tags.customTags ?? [])],
    [tags.customTags, tags.requiredTags]
  );

  const mutationGuard = useCallback(
    async <TResult>(action: () => Promise<TResult>) => {
      if (!isOnline) {
        throw new Error('Offline: operation not available.');
      }
      return action();
    },
    [isOnline]
  );

  const addTagMutation = useMutation({
    mutationFn: (tag: Tag) => mutationGuard(() => addCustomTag(tag)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });
    },
  });

  const removeTagMutation = useMutation({
    mutationFn: (tagName: string) =>
      mutationGuard(() => {
        if (!userId) {
          throw new Error('No user');
        }
        return removeCustomTag(userId, tagName);
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });
    },
  });

  const updateTagMutation = useMutation({
    mutationFn: (tag: Tag) => mutationGuard(() => updateTag(tag)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });
    },
  });

  return {
    tags,
    requiredTags: tags.requiredTags ?? [],
    customTags: tags.customTags ?? [],
    allTags,
    loading: tagsQuery.isLoading,
    error: tagsQuery.error as Error | null,
    refreshTags: tagsQuery.refetch,
    addCustomTag: addTagMutation.mutateAsync,
    removeCustomTag: removeTagMutation.mutateAsync,
    updateTag: updateTagMutation.mutateAsync,
  };
}
