import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { addCustomTag, getTags, removeCustomTag, updateTag } from '@/services/tag.service';
import { debugLog } from '@/utils/debugMode';
import { TAG_MUTATION_KEYS } from '@/utils/mutationDefaults';

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

  const tagsQuery = useServerFirstQuery<TagPayload>({
    queryKey: buildQueryKey(userId),
    queryFn: () => (userId ? getTags(userId) : Promise.resolve({
      requiredTags: [
        { id: '1', name: 'intro', color: '#3B82F6', translationKey: 'tags.introduction' },
        { id: '2', name: 'main', color: '#10B981', translationKey: 'tags.mainPart' },
        { id: '3', name: 'conclusion', color: '#F59E0B', translationKey: 'tags.conclusion' },
      ],
      customTags: [],
    })),
    enabled: true,
  });

  const tags = tagsQuery.data ?? EMPTY_TAGS;

  useEffect(() => {
    debugLog('Tags state', {
      isOnline,
      userId,
      requiredCount: tags.requiredTags?.length ?? 0,
      customCount: tags.customTags?.length ?? 0,
      isLoading: tagsQuery.isLoading,
    });
  }, [isOnline, userId, tags.requiredTags, tags.customTags, tagsQuery.isLoading]);

  const allTags = useMemo(
    () => [...(tags.requiredTags ?? []), ...(tags.customTags ?? [])],
    [tags.customTags, tags.requiredTags]
  );

  // Offline-buffered: the offline pre-throw is gone, so writes attempt the fetch,
  // pause + persist when offline, and replay on reconnect (mutationKey ties each
  // to its resumable default in mutationDefaults.ts). mutateAsync is kept so
  // callers still receive the server result (e.g. removeCustomTag's affected
  // count); offline the promise settles once the write replays on reconnect.
  const addTagMutation = useMutation({
    mutationKey: TAG_MUTATION_KEYS.add,
    mutationFn: (tag: Tag) => addCustomTag(tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });
    },
  });

  const removeTagMutation = useMutation({
    mutationKey: TAG_MUTATION_KEYS.remove,
    mutationFn: ({ userId: uid, tagName }: { userId: string; tagName: string }) =>
      removeCustomTag(uid, tagName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });
    },
  });

  const updateTagMutation = useMutation({
    mutationKey: TAG_MUTATION_KEYS.update,
    mutationFn: (tag: Tag) => updateTag(tag),
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
    removeCustomTag: (tagName: string) => {
      if (!userId) return Promise.reject(new Error('No user'));
      return removeTagMutation.mutateAsync({ userId, tagName });
    },
    updateTag: updateTagMutation.mutateAsync,
  };
}
