import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { addCustomTag, getTags, removeCustomTag, updateTag } from '@/services/tag.service';
import { newClientId } from '@/utils/clientId';
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
    queryFn: () => (userId ? getTags(userId) : Promise.resolve<TagPayload>({
      requiredTags: [
        { id: '1', userId: '', name: 'intro', color: '#3B82F6', required: true, translationKey: 'tags.introduction' },
        { id: '2', userId: '', name: 'main', color: '#10B981', required: true, translationKey: 'tags.mainPart' },
        { id: '3', userId: '', name: 'conclusion', color: '#F59E0B', required: true, translationKey: 'tags.conclusion' },
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
  //
  // Optimistic onMutate: without it a freshly added/edited/removed custom tag only
  // showed after the write + refetch (~1s online; not until reconnect offline) —
  // the same "I added it and it vanished, then came back" lag fixed in the other
  // list hooks. We only touch customTags (required tags are fixed) and roll back
  // on error; onSuccess refetches to reconcile with the authoritative list.
  const invalidateTags = () =>
    queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });

  const rollbackTags = (context: { previous?: TagPayload } | undefined) => {
    if (context?.previous) queryClient.setQueryData(buildQueryKey(userId), context.previous);
  };

  const snapshotTags = async () => {
    const queryKey = buildQueryKey(userId);
    await queryClient.cancelQueries({ queryKey });
    return { previous: queryClient.getQueryData<TagPayload>(queryKey) };
  };

  const writeCustomTags = (fn: (custom: Tag[]) => Tag[]) => {
    queryClient.setQueryData<TagPayload>(buildQueryKey(userId), (old = EMPTY_TAGS) => ({
      requiredTags: old?.requiredTags ?? [],
      customTags: fn(old?.customTags ?? []),
    }));
  };

  const addTagMutation = useMutation({
    mutationKey: TAG_MUTATION_KEYS.add,
    mutationFn: (tag: Tag) => addCustomTag(tag),
    onMutate: async (tag: Tag) => {
      const context = await snapshotTags();
      const optimistic: Tag = { ...tag, id: tag.id || newClientId() };
      writeCustomTags((custom) => [...custom.filter((c) => c.name !== optimistic.name), optimistic]);
      return context;
    },
    onError: (_err, _tag, context) => rollbackTags(context),
    onSuccess: invalidateTags,
  });

  const removeTagMutation = useMutation({
    mutationKey: TAG_MUTATION_KEYS.remove,
    mutationFn: ({ userId: uid, tagName }: { userId: string; tagName: string }) =>
      removeCustomTag(uid, tagName),
    onMutate: async ({ tagName }: { userId: string; tagName: string }) => {
      const context = await snapshotTags();
      writeCustomTags((custom) => custom.filter((c) => c.name !== tagName));
      return context;
    },
    onError: (_err, _vars, context) => rollbackTags(context),
    onSuccess: invalidateTags,
  });

  const updateTagMutation = useMutation({
    mutationKey: TAG_MUTATION_KEYS.update,
    mutationFn: (tag: Tag) => updateTag(tag),
    onMutate: async (tag: Tag) => {
      const context = await snapshotTags();
      writeCustomTags((custom) => custom.map((c) => (c.id === tag.id ? { ...c, ...tag } : c)));
      return context;
    },
    onError: (_err, _tag, context) => rollbackTags(context),
    onSuccess: invalidateTags,
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
