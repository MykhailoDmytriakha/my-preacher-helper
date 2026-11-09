import { useMemo } from 'react';

import { isLiveCollectionDocument, useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import {
  PLAN_TEMPLATE_AGGREGATE,
  type CreatePlanTemplatePayload,
  type UpdatePlanTemplatePayload,
} from '@/services/planTemplates.client';

import type { DocumentTitleSeen, PlanTemplateNameCapture } from '@/data-engine/documentFieldAction';
import type { DocumentData } from '@/data-engine/types';
import type { PlanTemplate } from '@/models/models';

/**
 * The person's plan templates, read from and written through the data engine. Edits of the
 * previous version that never reached the server are kept for the person by the migration
 * archive (`legacyQueryRecovery.client.ts`), not replayed here.
 */
export function usePlanTemplates(userId: string | null | undefined) {
  const engineTemplates = useDataCollection(userId ? 'planTemplates' : null);
  const documentActions = useDocumentActions();
  const templates = useMemo<PlanTemplate[]>(() => (engineTemplates.state?.documents ?? [])
    .filter(isLiveCollectionDocument)
    .map(row => ({ ...(row.value as unknown as PlanTemplate), id: row.resource.id }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [engineTemplates.state?.documents]);
  const now = () => new Date().toISOString();

  const observeName = (id: string, name: string): DocumentTitleSeen | undefined => {
    const row = engineTemplates.state?.documents?.find(item => item.resource.id === id);
    if (row?.needsAttention) return undefined;
    if (row?.value?.name === name && row.submittedTitle?.title === name) return row.submittedTitle;
    const observed = [row?.acknowledged, engineTemplates.state?.snapshots?.find(item => item.resource.id === id)].find(snapshot =>
      snapshot?.value?.name === name && snapshot.metadata && !snapshot.metadata.deleted);
    const metadata = observed?.metadata;
    return metadata ? { title: name, generation: metadata.generation, revision: metadata.revision } : undefined;
  };

  return {
    templates,
    observeName,
    captureActionTime: documentActions.captureActionTime,
    loading: Boolean(userId) && engineTemplates.loading,
    error: engineTemplates.error ? new Error(engineTemplates.error) : null,
    refresh: engineTemplates.refresh,
    createTemplate: (payload: CreatePlanTemplatePayload): Promise<void> =>
      documentActions.create({ collection: 'planTemplates', id: payload.id },
        { userId: payload.userId, name: payload.name, structure: payload.structure as never, createdAt: now(), updatedAt: now() }),
    updateTemplate: (id: string, updates: UpdatePlanTemplatePayload, expectedRevision?: number | null, nameCapture?: PlanTemplateNameCapture): Promise<void> => {
      // A proven name-only action compares the shown name. Other edits keep the existing revision guard.
      let refusedAt: number | null = null;
      const rename = nameCapture && typeof updates.name === 'string' && updates.structure === undefined
        ? { kind: 'plan-template-name' as const, name: nameCapture } : undefined;
      const resource = { collection: 'planTemplates', id };
      const update = (current: DocumentData | null) => {
        if (!current) throw new Error('The template was deleted');
        const actual = (current.rev as Record<string, number> | undefined)?.[PLAN_TEMPLATE_AGGREGATE] ?? 0;
        if (!rename && expectedRevision != null && actual !== expectedRevision) { refusedAt = actual; return current; }
        return { ...current, ...(updates as Record<string, never>), updatedAt: now() };
      };
      const request = rename ? documentActions.commit(resource, update, rename) : documentActions.commit(resource, update);
      return request.then(() => {
        if (refusedAt !== null) throw new StaleWriteError(PLAN_TEMPLATE_AGGREGATE, expectedRevision ?? 0, refusedAt);
      });
    },
    deleteTemplate: (id: string): Promise<void> =>
      documentActions.remove({ collection: 'planTemplates', id }),
  };
}
