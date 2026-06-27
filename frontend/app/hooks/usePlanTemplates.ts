import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import {
  createPlanTemplate,
  deletePlanTemplate,
  getPlanTemplates,
  updatePlanTemplate,
  type CreatePlanTemplatePayload,
  type UpdatePlanTemplatePayload,
} from '@/services/planTemplate.service';
import { PLAN_TEMPLATE_MUTATION_KEYS } from '@/utils/mutationDefaults';

import type { PlanTemplate } from '@/models/models';

const buildQueryKey = (userId: string | null | undefined) => ['planTemplates', userId ?? null];

export function usePlanTemplates(userId: string | null | undefined) {
  const queryClient = useQueryClient();

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
    mutationFn: ({ id, updates }: { id: string; updates: UpdatePlanTemplatePayload }) =>
      updatePlanTemplate(id, updates),
    onMutate: async ({ id, updates }: { id: string; updates: UpdatePlanTemplatePayload }) => {
      const context = await snapshot();
      queryClient.setQueryData<PlanTemplate[]>(buildQueryKey(userId), (old = []) =>
        old.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
      return context;
    },
    onError: (_err, _vars, context) => rollback(context),
    onSuccess: invalidate,
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

  return {
    templates: templatesQuery.data ?? [],
    loading: templatesQuery.isLoading,
    error: templatesQuery.error as Error | null,
    refresh: templatesQuery.refetch,
    createTemplate: createMutation.mutateAsync,
    updateTemplate: (id: string, updates: UpdatePlanTemplatePayload) =>
      updateMutation.mutateAsync({ id, updates }),
    deleteTemplate: deleteMutation.mutateAsync,
  };
}
