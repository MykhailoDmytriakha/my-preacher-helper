import type { ServiceOrder, ServiceOrderStep } from '@/models/models';

export type ServiceOrderContent = Pick<ServiceOrder, 'title' | 'summary' | 'steps'>;

/** Placement and bookkeeping are not changes to the service being read or edited. */
export function selectServiceOrderContent(data: Record<string, unknown>): ServiceOrderContent {
  return {
    title: typeof data.title === 'string' ? data.title : '',
    summary: typeof data.summary === 'string' ? data.summary : '',
    steps: ((data.steps ?? []) as ServiceOrderStep[]).map(step => ({
      id: step.id,
      title: step.title ?? '',
      body: step.body ?? '',
      scriptureRefs: step.scriptureRefs ?? [],
      flagged: step.flagged === true,
    })),
  };
}
