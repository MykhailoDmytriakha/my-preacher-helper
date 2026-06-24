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

  const createMutation = useMutation({
    mutationKey: PLAN_TEMPLATE_MUTATION_KEYS.create,
    mutationFn: (payload: CreatePlanTemplatePayload) => createPlanTemplate(payload),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationKey: PLAN_TEMPLATE_MUTATION_KEYS.update,
    mutationFn: ({ id, updates }: { id: string; updates: UpdatePlanTemplatePayload }) =>
      updatePlanTemplate(id, updates),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationKey: PLAN_TEMPLATE_MUTATION_KEYS.delete,
    mutationFn: (id: string) => deletePlanTemplate(id),
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
