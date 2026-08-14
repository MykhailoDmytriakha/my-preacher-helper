import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { addCustomTag, getTags, removeCustomTag, updateTag } from '@/services/tag.service';
import { newClientId } from '@/utils/clientId';
import { debugLog } from '@/utils/debugMode';
import { TAG_MUTATION_KEYS } from '@/utils/mutationDefaults';
import {
  persistedWrite,
  queuedMutation,
  refusedWrite,
  useWriteRecovery,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { recoveryText } from '@/utils/writeRecovery';

import type { Tag } from '@/models/models';

type TagPayload = {
  requiredTags: Tag[];
  customTags: Tag[];
};

const EMPTY_TAGS: TagPayload = { requiredTags: [], customTags: [] };

const buildQueryKey = (userId: string | null | undefined) => ['tags', userId ?? null];

export function useTags(userId: string | null | undefined) {
  const { t } = useTranslation();
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

  useWriteRecovery<Tag>(queryClient, {
    mutationKey: TAG_MUTATION_KEYS.add,
    fallbackTitleKey: 'errors.savingError',
    recoveryText: (tag) => recoveryText([tag.name, tag.color]),
    toastId: (tag) => `write-recovery:tag:add:${tag.id}`,
    /**
     * A reserved name is INPUT this app will not accept, not a write the server
     * refused — and the form explains it precisely, next to the field. Reporting it
     * here as well gave the person two messages for one action, one of which said
     * something vaguer than the other.
     */
    owns: (tag) => tag.userId === userId,
    ignore: (error) => (error as { message?: string } | null)?.message === 'Reserved tag name',
    retry: (tag) => addTagMutation.mutate(tag),
  });

  useWriteRecovery<{ userId: string; tagName: string }>(queryClient, {
    mutationKey: TAG_MUTATION_KEYS.remove,
    fallbackTitleKey: 'errors.removingError',
    recoveryText: (payload) => payload.tagName,
    toastId: (payload) => `write-recovery:tag:remove:${payload.userId}:${payload.tagName}`,
    owns: (payload) => payload.userId === userId,
    retry: (payload) => removeTagMutation.mutate(payload),
  });

  useWriteRecovery<Tag>(queryClient, {
    mutationKey: TAG_MUTATION_KEYS.update,
    fallbackTitleKey: 'errors.savingError',
    recoveryText: (tag) => recoveryText([tag.name, tag.color]),
    toastId: (tag) => `write-recovery:tag:update:${tag.id}`,
    owns: (tag) => tag.userId === userId,
    retry: (tag) => updateTagMutation.mutate(tag),
  });

  return {
    tags,
    requiredTags: tags.requiredTags ?? [],
    customTags: tags.customTags ?? [],
    allTags,
    loading: tagsQuery.isLoading,
    error: tagsQuery.error as Error | null,
    refreshTags: tagsQuery.refetch,
    addCustomTag: (tag: Tag): WriteSubmission => {
      const payload = { ...tag, id: tag.id || newClientId() };
      return queuedMutation(`tag:add:${payload.id}`, addTagMutation.mutateAsync(payload));
    },
    removeCustomTag: (tagName: string): WriteSubmission => {
      if (!userId) {
        return refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));
      }
      const payload = { userId, tagName };
      // DELETE is a plain fetch request, so only a server response can accept it.
      return persistedWrite(removeTagMutation.mutateAsync(payload));
    },
    updateTag: (tag: Tag): WriteSubmission =>
      queuedMutation(`tag:update:${tag.id}`, updateTagMutation.mutateAsync(tag)),
  };
}
