import { useMemo } from 'react';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import {
  PLAN_TEMPLATE_AGGREGATE,
  type CreatePlanTemplatePayload,
  type UpdatePlanTemplatePayload,
} from '@/services/planTemplates.client';
import { queuedMutation, queuedWrite, type WriteSubmission } from '@/utils/recoverableWrite';

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
    .flatMap(row => row.value ? [{ ...(row.value as unknown as PlanTemplate), id: row.resource.id }] : [])
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [engineTemplates.state?.documents]);
  const now = () => new Date().toISOString();

  return {
    templates,
    loading: Boolean(userId) && engineTemplates.loading,
    error: engineTemplates.error ? new Error(engineTemplates.error) : null,
    refresh: engineTemplates.refresh,
    createTemplate: (payload: CreatePlanTemplatePayload): WriteSubmission => queuedMutation(`plan-template:create:${payload.id}`,
      documentActions.create({ collection: 'planTemplates', id: payload.id },
        { userId: payload.userId, name: payload.name, structure: payload.structure as never, createdAt: now(), updatedAt: now() })),
    updateTemplate: (id: string, updates: UpdatePlanTemplatePayload, expectedRevision?: number | null): WriteSubmission => {
      // An edit built from an older template is refused with the revision the template holds
      // now, and the screen offers the choice.
      let refusedAt: number | null = null;
      const request = documentActions.commit({ collection: 'planTemplates', id }, current => {
        if (!current) throw new Error('The template was deleted');
        const actual = (current.rev as Record<string, number> | undefined)?.[PLAN_TEMPLATE_AGGREGATE] ?? 0;
        if (expectedRevision != null && actual !== expectedRevision) { refusedAt = actual; return current; }
        return { ...current, ...(updates as Record<string, never>), updatedAt: now() };
      }).then(() => {
        if (refusedAt !== null) throw new StaleWriteError(PLAN_TEMPLATE_AGGREGATE, expectedRevision ?? 0, refusedAt);
      });
      return queuedWrite(`plan-template:update:${id}`, request);
    },
    deleteTemplate: (id: string): WriteSubmission =>
      queuedMutation(`plan-template:delete:${id}`, documentActions.remove({ collection: 'planTemplates', id })),
  };
}
