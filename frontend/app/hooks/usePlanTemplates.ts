import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { isOfflineQueuedError, isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import {
  createPlanTemplate,
  deletePlanTemplate,
  getPlanTemplates,
  updatePlanTemplate,
  type CreatePlanTemplatePayload,
  type UpdatePlanTemplatePayload,
} from '@/services/planTemplate.service';
import { PLAN_TEMPLATE_MUTATION_KEYS } from '@/utils/mutationDefaults';
import { queuedMutation, queuedWrite, useWriteRecovery, type WriteSubmission } from '@/utils/recoverableWrite';
import { recoveryText } from '@/utils/writeRecovery';

import type { PlanTemplate } from '@/models/models';

const buildQueryKey = (userId: string | null | undefined) => ['planTemplates', userId ?? null];

export function usePlanTemplates(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  const rejectedRevisionByTemplateId = useRef(new Map<string, number>());

  const templatesQuery = useServerFirstQuery<PlanTemplate[]>({
    queryKey: buildQueryKey(userId),
    queryFn: () => (userId ? getPlanTemplates(userId) : Promise.resolve([])),
    enabled: !!userId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });

  // Optimistic helpers — without them every list op (create/rename/delete) only
  // showed after the server write + refetch (~1s of the item appearing to vanish,
  // then pop back). We snapshot the cache, apply the change immediately, and roll
  // back on error; onSuccess re-fetches to reconcile with the authoritative list.
  const sortByName = (list: PlanTemplate[]) =>
    [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const rollback = (context: { previous?: PlanTemplate[] } | undefined) => {
    if (context?.previous) queryClient.setQueryData(buildQueryKey(userId), context.previous);
  };

  const snapshot = async () => {
    const queryKey = buildQueryKey(userId);
    await queryClient.cancelQueries({ queryKey });
    return { previous: queryClient.getQueryData<PlanTemplate[]>(queryKey) };
  };

  const createMutation = useMutation({
    mutationKey: PLAN_TEMPLATE_MUTATION_KEYS.create,
    mutationFn: (payload: CreatePlanTemplatePayload) => createPlanTemplate(payload),
    onMutate: async (payload: CreatePlanTemplatePayload) => {
      const context = await snapshot();
      const now = new Date().toISOString();
      const optimistic: PlanTemplate = {
        id: payload.id,
        userId: payload.userId,
        name: payload.name,
        structure: payload.structure,
        createdAt: now,
        updatedAt: now,
      };
      queryClient.setQueryData<PlanTemplate[]>(buildQueryKey(userId), (old = []) =>
        sortByName([...old.filter((t) => t.id !== payload.id), optimistic])
      );
      return context;
    },
    onError: (_err, _payload, context) => rollback(context),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationKey: PLAN_TEMPLATE_MUTATION_KEYS.update,
    mutationFn: ({
      id,
      updates,
      expectedRevision,
    }: {
      id: string;
      updates: UpdatePlanTemplatePayload;
      expectedRevision?: number | null;
    }) => updatePlanTemplate(id, updates, expectedRevision ?? null, userId ?? undefined),
    onMutate: async ({
      id,
      updates,
    }: {
      id: string;
      updates: UpdatePlanTemplatePayload;
      expectedRevision?: number | null;
    }) => {
      const context = await snapshot();
      queryClient.setQueryData<PlanTemplate[]>(buildQueryKey(userId), (old = []) =>
        old.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
      return context;
    },
    onError: (error, variables, context) => {
      /**
       * A QUEUED write is stored, not failed. `conflictSafeUpdate` puts the change in the
       * durable outbox when Firestore is unreachable — including when the browser still
       * calls itself online — so undoing the optimistic view here would take away an edit
       * that is safely waiting to replay, and invite the person to enter it twice.
       */
      if (isOfflineQueuedError(error)) return;
      if (isStaleWriteError(error)) {
        rejectedRevisionByTemplateId.current.set(variables.id, error.actualRevision);
      }
      rollback(context);
    },
    onSuccess: (_data, variables) => {
      rejectedRevisionByTemplateId.current.delete(variables.id);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationKey: PLAN_TEMPLATE_MUTATION_KEYS.delete,
    mutationFn: (id: string) => deletePlanTemplate(id),
    onMutate: async (id: string) => {
      const context = await snapshot();
      queryClient.setQueryData<PlanTemplate[]>(buildQueryKey(userId), (old = []) =>
        old.filter((t) => t.id !== id)
      );
      return context;
    },
    onError: (_err, _id, context) => rollback(context),
    onSuccess: invalidate,
  });

  /**
   * A template belongs to this person only if it is in THEIR loaded list. Failed
   * mutations survive in a shared IndexedDB cache across sign-outs, so without this
   * check the next account would be shown the previous account's template name and
   * structure, verbatim, with a copy button.
   */
  const ownsTemplate = (id: string) =>
    Boolean(userId) && (templatesQuery.data ?? []).some((template) => template.id === id);

  useWriteRecovery<CreatePlanTemplatePayload>(queryClient, {
    mutationKey: PLAN_TEMPLATE_MUTATION_KEYS.create,
    fallbackTitleKey: 'planTemplates.createError',
    titleParams: (payload) => ({ name: payload.name }),
    // The structure IS the work here; the update descriptor already carries it, and a
    // create that carries only the name hands back an empty template.
    recoveryText: (payload) => recoveryText([payload.name, JSON.stringify(payload.structure)]),
    toastId: (payload) => `write-recovery:plan-template:create:${payload.id}`,
    owns: (payload) => payload.userId === userId,
    retry: (payload) => createMutation.mutate(payload),
  });

  useWriteRecovery<{ id: string; updates: UpdatePlanTemplatePayload; expectedRevision?: number | null }>(queryClient, {
    mutationKey: PLAN_TEMPLATE_MUTATION_KEYS.update,
    fallbackTitleKey: 'planTemplates.saveStructureError',
    recoveryText: (payload) => recoveryText([payload.updates.name, JSON.stringify(payload.updates.structure)]),
    toastId: (payload) => `write-recovery:plan-template:update:${payload.id}`,
    ownershipEpoch: `${userId ?? ''}:${(templatesQuery.data ?? []).map((template) => template.id).join(',')}`,
    owns: (payload) => ownsTemplate(payload.id),
    /**
     * A stale revision is a CHOICE — "keep mine / take theirs" — offered by the settings
     * section, which also holds the typed name or the edited structure. A recovery toast
     * on top of it gave the person two, sometimes three, competing paths for one event.
     */
    ignore: (error) => isStaleWriteError(error),
    retry: (payload) =>
      updateMutation.mutate({
        ...payload,
        expectedRevision:
          rejectedRevisionByTemplateId.current.get(payload.id) ?? payload.expectedRevision,
      }),
  });

  useWriteRecovery<string>(queryClient, {
    mutationKey: PLAN_TEMPLATE_MUTATION_KEYS.delete,
    fallbackTitleKey: 'planTemplates.deleteError',
    recoveryText: () => undefined,
    toastId: (id) => `write-recovery:plan-template:delete:${id}`,
    ownershipEpoch: `${userId ?? ''}:${(templatesQuery.data ?? []).map((template) => template.id).join(',')}`,
    // See useSeries: "anyone signed in" would announce a previous account's refused
    // delete to the next person. It is mine only if the template is (or was) mine.
    owns: (id) => ownsTemplate(id),
    retry: (id) => deleteMutation.mutate(id),
  });

  return {
    templates: templatesQuery.data ?? [],
    loading: templatesQuery.isLoading,
    error: templatesQuery.error as Error | null,
    refresh: templatesQuery.refetch,
    createTemplate: (payload: CreatePlanTemplatePayload): WriteSubmission =>
      queuedMutation(`plan-template:create:${payload.id}`, createMutation.mutateAsync(payload)),
    updateTemplate: (
      id: string,
      updates: UpdatePlanTemplatePayload,
      expectedRevision?: number | null
    ): WriteSubmission => {
      const payload = { id, updates, expectedRevision, userId: userId ?? undefined };
      /**
       * Guarded writes wait for the transaction's answer, because a stale revision is
       * actionable editor state rather than a queue hand-off — but OFFLINE there is no
       * transaction to wait for. `conflictSafeUpdate` stores the intent and reports it
       * by THROWING `OfflineQueuedError`, so `persistedWrite` alone turned a safely
       * stored edit into a refusal: the optimistic value rolled back and the person was
       * told their queued change had failed.
       */
      return queuedWrite(`plan-template:update:${id}`, updateMutation.mutateAsync(payload));
    },
    deleteTemplate: (id: string): WriteSubmission =>
      queuedMutation(`plan-template:delete:${id}`, deleteMutation.mutateAsync(id)),
  };
}
