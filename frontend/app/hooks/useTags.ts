import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { newClientId } from '@/utils/clientId';
import { debugLog } from '@/utils/debugMode';
import {
  queuedMutation,
  refusedWrite,
  skippedWrite,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { isStructureTag } from '@/utils/structureTags';

import type { Tag } from '@/models/models';

type TagPayload = {
  requiredTags: Tag[];
  customTags: Tag[];
};

const NO_TAGS: Tag[] = [];

/**
 * The person's custom tags, read from and written through the data engine. Edits of the previous
 * version that never reached the server are kept for the person by the migration archive
 * (`legacyQueryRecovery.client.ts`), not replayed here.
 */
export function useTags(userId: string | null | undefined) {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const engineTags = useDataCollection(userId ? 'tags' : null);
  const documentActions = useDocumentActions();

  const customTags = useMemo<Tag[]>(() => (engineTags.state?.documents ?? []).flatMap(row => {
    const value = row.value as Partial<Tag> | null;
    if (!value || value.required !== false || typeof value.name !== 'string' || isStructureTag(value.name)
      || isStructureTag(row.resource.id)) return [];
    return [{ ...value, id: row.resource.id } as Tag];
  }), [engineTags.state?.documents]);
  const tags = useMemo<TagPayload>(() => ({ requiredTags: NO_TAGS, customTags }), [customTags]);

  useEffect(() => {
    debugLog('Tags state', { isOnline, userId, customCount: customTags.length, isLoading: engineTags.loading });
  }, [isOnline, userId, customTags.length, engineTags.loading]);

  const byName = (name: string) => customTags.find(tag => tag.name === name);
  return {
    tags, requiredTags: NO_TAGS, customTags, allTags: customTags,
    loading: Boolean(userId) && engineTags.loading, error: engineTags.error ? new Error(engineTags.error) : null,
    refreshTags: engineTags.refresh,
    addCustomTag: (tag: Tag): WriteSubmission => {
      if (!userId) return refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));
      const id = tag.id || newClientId();
      // The form's own messages explain these two refusals next to the field.
      if (isStructureTag(tag.name)) return queuedMutation(`tag:add:${id}`, Promise.reject(new Error('Reserved tag name')));
      if (byName(tag.name)) return queuedMutation(`tag:add:${id}`, Promise.reject(new Error('Tag with same name and userId already exists')));
      return queuedMutation(`tag:add:${id}`, documentActions.create({ collection: 'tags', id },
        { userId, name: tag.name, color: tag.color, required: false, createdAt: new Date().toISOString() }));
    },
    removeCustomTag: (tagName: string): WriteSubmission => {
      const existing = byName(tagName);
      if (!existing) return skippedWrite();
      // The engine removes the tag from every sermon's thoughts in the same operation.
      return queuedMutation(`tag:remove:${existing.id}`, documentActions.remove({ collection: 'tags', id: existing.id }));
    },
    updateTag: (tag: Tag): WriteSubmission => queuedMutation(`tag:update:${tag.id}`, documentActions.commit(
      { collection: 'tags', id: tag.id }, current => {
        if (!current) throw new Error('The tag was deleted');
        return { ...current, name: tag.name, color: tag.color, updatedAt: new Date().toISOString() };
      })),
  };
}
